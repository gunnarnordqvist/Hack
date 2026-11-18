"""Live server: serves web/ and three JSON endpoints. Standard library only (plus the ranker's optional model).

  GET /api/health                       -> {ok, model}
  GET /api/candidates?q=&mode=&k=       -> ranked SNOMED CT findings (mode: text | rerank)
  GET /api/validate?code=               -> {ok, display}  (CodeSystem/$validate-code on the terminology server)

  python server.py [--port 8765] [--no-model]
"""
from __future__ import annotations

import argparse
import json
import mimetypes
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from rank import Ranker
from tx import Tx

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
CFG = json.loads((ROOT / "backend" / "topics.json").read_text(encoding="utf8"))
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("application/json", ".json")


def make_handler(tx: Tx, ranker: Ranker):
    class H(BaseHTTPRequestHandler):
        def _send(self, status: int, body: bytes, ctype: str):
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def _json(self, obj, status=200):
            self._send(status, json.dumps(obj, ensure_ascii=False).encode("utf8"), "application/json; charset=utf-8")

        def do_GET(self):  # noqa: N802
            u = urllib.parse.urlparse(self.path)
            q = dict(urllib.parse.parse_qsl(u.query))
            if u.path == "/api/health":
                return self._json({"ok": True, "model": ranker.model_name if ranker.has_model else None,
                                   "universe": len(ranker.universe)})
            if u.path == "/api/candidates":
                try:
                    return self._json(ranker.candidates(q.get("q", ""), q.get("mode", "rerank"), int(q.get("k", "5"))))
                except Exception as e:  # keep the demo alive; the frontend falls back to its local ranking
                    return self._json({"error": str(e)}, 502)
            if u.path == "/api/validate":
                code = q.get("code", "")
                if not code.isdigit():
                    return self._json({"ok": False, "error": "code must be digits"}, 400)
                try:
                    return self._json(tx.validate(code))
                except Exception as e:
                    return self._json({"error": str(e)}, 502)
            # static files from web/
            rel = u.path.lstrip("/") or "index.html"
            f = (WEB / rel).resolve()
            if WEB not in f.parents and f != WEB / rel:
                return self._send(403, b"forbidden", "text/plain")
            if not f.is_file():
                return self._send(404, b"not found", "text/plain")
            ctype = mimetypes.guess_type(str(f))[0] or "application/octet-stream"
            if ctype.startswith("text/") or ctype in ("application/json", "text/javascript"):
                ctype += "; charset=utf-8"
            self._send(200, f.read_bytes(), ctype)

        def log_message(self, fmt, *args):  # quiet
            pass

    return H


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--no-model", action="store_true")
    a = ap.parse_args()
    tx = Tx()
    ranker = Ranker(tx, CFG, embeddings=not a.no_model)
    srv = ThreadingHTTPServer(("127.0.0.1", a.port), make_handler(tx, ranker))
    print(f"serving http://127.0.0.1:{a.port}  model={'on' if ranker.has_model else 'off'}  universe={len(ranker.universe)}", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
