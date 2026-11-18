"""Thin FHIR R4 terminology client with a disk cache.

Talks to a FHIR terminology server (default: HL7 Nordics tx-nordics.fhir.org) using only the standard
operations ValueSet/$expand, ValueSet/$validate-code and CodeSystem/$lookup. Every response is cached on
disk, so a session can be replayed offline (set PENPAD_OFFLINE=1) and tests run without a network.

SNOMED CT content comes from the server; nothing here creates or changes SNOMED concepts.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

SCT = "http://snomed.info/sct"
DEFAULT_BASE = "https://tx-nordics.fhir.org/fhir/r4"
# Swedish module of SNOMED CT (NRC maintained). Gives Swedish terms via displayLanguage=sv.
SWEDEN_MODULE = "http://snomed.info/sct/45991000052106/version/20260531"
HEADERS = {"Accept": "application/fhir+json", "User-Agent": "penpad-snomed-demo/0.1"}


class OfflineMiss(RuntimeError):
    """Raised in offline mode when a request is not in the cache."""


class Tx:
    def __init__(self, base: str | None = None, cache_dir: str | Path | None = None, offline: bool | None = None):
        self.base = (base or os.environ.get("PENPAD_TX", DEFAULT_BASE)).rstrip("/")
        root = Path(__file__).resolve().parent.parent
        self.cache = Path(cache_dir or os.environ.get("PENPAD_CACHE", root / "cache" / "tx"))
        self.cache.mkdir(parents=True, exist_ok=True)
        self.offline = bool(int(os.environ.get("PENPAD_OFFLINE", "0"))) if offline is None else offline
        self.calls = 0
        self.hits = 0

    # -- low level ---------------------------------------------------------------------------
    def _get(self, path: str, params: dict[str, str]) -> dict:
        query = urllib.parse.urlencode(sorted(params.items()))
        url = f"{self.base}/{path}?{query}"
        key = hashlib.sha1(url.encode()).hexdigest()
        f = self.cache / f"{key}.json"
        if f.exists():
            self.hits += 1
            return json.loads(f.read_text())
        if self.offline:
            raise OfflineMiss(url)
        last = None
        for attempt in range(3):
            try:
                req = urllib.request.Request(url, headers=HEADERS)
                with urllib.request.urlopen(req, timeout=60) as r:
                    data = json.load(r)
                self.calls += 1
                f.write_text(json.dumps(data))
                return data
            except urllib.error.HTTPError as e:  # FHIR servers answer 4xx with an OperationOutcome
                body = e.read().decode("utf8", "replace")
                try:
                    data = json.loads(body)
                except ValueError:
                    data = {"resourceType": "OperationOutcome", "issue": [{"diagnostics": body[:300]}]}
                data["_http"] = e.code
                if e.code < 500:
                    return data
                last = e
            except Exception as e:  # network hiccup
                last = e
            time.sleep(1.5 * (attempt + 1))
        raise RuntimeError(f"terminology server unreachable: {last}")

    # -- operations --------------------------------------------------------------------------
    def expand(self, ecl: str, *, filter: str | None = None, lang: str = "en", count: int = 1000,
               offset: int = 0) -> dict:
        """ValueSet/$expand on an implicit SNOMED ECL value set. lang 'sv' uses the Swedish module."""
        p = {"url": f"{SCT}?fhir_vs=ecl/{ecl}", "count": str(count), "offset": str(offset)}
        if filter:
            p["filter"] = filter
        if lang == "sv":
            p["system-version"] = f"{SCT}|{SWEDEN_MODULE}"
            p["displayLanguage"] = "sv"
        return self._get("ValueSet/$expand", p)

    def expand_all(self, ecl: str, *, lang: str = "en", page: int = 1000, limit: int = 5000) -> list[dict]:
        out: list[dict] = []
        while len(out) < limit:
            d = self.expand(ecl, lang=lang, count=page, offset=len(out))
            got = d.get("expansion", {}).get("contains", [])
            if not got:
                break
            out += got
            total = d["expansion"].get("total")
            if total is not None and len(out) >= total:
                break
        return out

    def lookup(self, code: str, lang: str = "en") -> dict:
        """CodeSystem/$lookup flattened to {display, properties, normalForm, parents}."""
        p = {"system": SCT, "code": code, "property": "*"}
        if lang == "sv":
            p.update({"version": SWEDEN_MODULE, "displayLanguage": "sv"})
        d = self._get("CodeSystem/$lookup", p)
        if d.get("resourceType") != "Parameters":
            return {"code": code, "error": _issue(d)}
        out: dict = {"code": code, "parents": [], "children": [], "version": None}
        for part in d.get("parameter", []):
            n = part["name"]
            if n == "display":
                out["display"] = part.get("valueString")
            elif n == "version":
                out["version"] = part.get("valueString")
            elif n == "property":
                kv = {x["name"]: x for x in part.get("part", [])}
                c = kv.get("code", {}).get("valueCode")
                v = kv.get("value", {})
                val = v.get("valueCode") or v.get("valueString") or v.get("valueBoolean") or v.get("valueCoding")
                if c == "parent":
                    out["parents"].append(val)
                elif c == "child":
                    out["children"].append(val)
                elif c in ("normalForm", "normalFormTerse", "inactive", "sufficientlyDefined"):
                    out[c] = val
        return out

    def validate(self, code: str, ecl: str | None = None) -> dict:
        """Is `code` an active SNOMED concept, optionally a member of the ECL value set? -> {ok, display}."""
        if ecl is None:
            d = self._get("CodeSystem/$validate-code", {"url": SCT, "code": code})
        else:
            d = self._get("ValueSet/$validate-code",
                          {"url": f"{SCT}?fhir_vs=ecl/{ecl}", "system": SCT, "code": code})
        res = {"ok": False, "display": None}
        for part in d.get("parameter", []):
            if part["name"] == "result":
                res["ok"] = bool(part.get("valueBoolean"))
            elif part["name"] == "display":
                res["display"] = part.get("valueString")
            elif part["name"] == "message":
                res["message"] = part.get("valueString")
        if d.get("resourceType") == "OperationOutcome":
            res["message"] = _issue(d)
        return res

    def in_refset(self, code: str, refset: str) -> bool:
        return self.validate(code, f"^ {refset}")["ok"]


def _issue(d: dict) -> str:
    try:
        i = d["issue"][0]
        return i.get("diagnostics") or i.get("details", {}).get("text") or "error"
    except Exception:
        return "error"


_SITE_RE = re.compile(r"363698007\|[^|]*\|=\(?(\d+)\|([^|]*)\|")


def finding_site(normal_form: str | None) -> tuple[str, str] | None:
    """First finding site (code, english name) from a SNOMED normalForm string, if any."""
    if not normal_form:
        return None
    m = _SITE_RE.search(normal_form)
    return (m.group(1), m.group(2)) if m else None
