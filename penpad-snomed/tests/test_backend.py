"""Backend tests. Config integrity needs nothing; ranking tests need the terminology server or a warm cache
(they are skipped, not failed, when neither is available)."""
import json
import os
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "backend"))

from rank import Ranker, lex_score, stems  # noqa: E402
from tx import OfflineMiss, Tx, finding_site  # noqa: E402

CFG = json.loads((HERE.parent / "backend" / "topics.json").read_text(encoding="utf8"))


class ConfigIntegrity(unittest.TestCase):
    def test_topic_slots_exist(self):
        for t in CFG["topics"]:
            for s in t["slots"]:
                self.assertIn(s, CFG["slots"], f"topic {t['id']} uses unknown slot {s}")

    def test_lexicon_codes_belong_to_a_slot(self):
        slot_codes = {c for s in CFG["slots"].values() for c in s.get("quick", []) + s.get("more", [])}
        for code in CFG["lexicon"]:
            self.assertIn(code, slot_codes, f"lexicon code {code} is in no slot")

    def test_quick_codes_are_digits_and_unique_per_slot(self):
        for name, s in CFG["slots"].items():
            q = s.get("quick", [])
            self.assertEqual(len(q), len(set(q)), name)
            for c in q:
                self.assertTrue(c.isdigit(), f"{name}: {c}")

    def test_patient_phrases_cover_quick_codes(self):
        for lang in ("sv", "en"):
            for slot in ("severity", "onset", "pattern", "progress", "character", "consistency"):
                for c in CFG["slots"][slot]["quick"]:
                    self.assertIn(c, CFG["patientPhrases"][lang][slot], f"{lang}/{slot}/{c}")


class TextRules(unittest.TestCase):
    def test_stems_drop_stop_words(self):
        self.assertEqual(stems("ont i tummen"), ["ont", "tumme"])

    def test_lex_score_prefers_exact(self):
        self.assertGreater(lex_score("smärta i tumme", "smärta i tumme"), lex_score("smärta i tumme", "smärta i finger"))
        self.assertEqual(lex_score("xyz", "smärta i tumme"), 0.0)

    def test_finding_site_from_normal_form(self):
        nf = "=== 313134005|Finding of thumb|:{363698007|Finding site|=(76505004|Thumb structure|:272741003|Laterality|=182353008|Side|)}"
        self.assertEqual(finding_site(nf), ("76505004", "Thumb structure"))
        self.assertIsNone(finding_site("=== 404684003|Clinical finding|"))
        self.assertIsNone(finding_site(None))


class Ranking(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        try:
            cls.r = Ranker(Tx(), CFG, embeddings=False)
        except (OfflineMiss, RuntimeError) as e:
            raise unittest.SkipTest(f"no terminology server and no warm cache: {e}")

    def test_swedish_baseline_finds_pain_in_thumb(self):
        d = self.r.candidates("smärta i tumme", "text", 3)
        self.assertEqual(d["items"][0]["code"], "300955002")
        self.assertFalse(d["low_confidence"])

    def test_every_candidate_is_in_the_server_universe(self):
        d = self.r.candidates("svullen tumme", "text", 5)
        for it in d["items"]:
            self.assertIn(it["code"], self.r.universe)

    def test_empty_query(self):
        d = self.r.candidates("  ", "text")
        self.assertEqual(d["items"], [])
        self.assertTrue(d["low_confidence"])

    def test_detail_gives_lateralizable_site_for_thumb(self):
        d = self.r.detail("300955002")
        self.assertEqual(d["site"]["code"], "76505004")
        self.assertTrue(d["site"]["lateralizable"])


if __name__ == "__main__":
    unittest.main()
