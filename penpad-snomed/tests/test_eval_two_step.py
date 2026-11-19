"""The pure parts of the embedding evaluation (no model needed): spans, hit counting, ranking over names, slot scoring."""
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "backend"))

try:
    import numpy as np  # noqa: F401
    import eval_two_step as ev
except Exception as e:  # numpy missing: the evaluation is optional
    ev = None
    SKIP = str(e)


@unittest.skipIf(ev is None, "optional evaluation needs numpy")
class Pure(unittest.TestCase):
    def test_spans_are_one_to_three_words_and_skip_filler(self):
        sp = ev.spans("ont i vänster tumme")
        self.assertIn("vänster", sp)
        self.assertIn("vänster tumme", sp)
        self.assertNotIn("i", sp)
        self.assertTrue(all(len(s.split()) <= 3 for s in sp))

    def test_spans_never_start_or_end_with_filler(self):
        for sp in ev.spans("det gör ont i höger knä och jag har det"):
            ws = sp.split()
            self.assertNotIn(ws[0], ev.STOP)
            self.assertNotIn(ws[-1], ev.STOP)

    def test_hits_lenient_counts_any_accepted_code_strict_only_the_first(self):
        r = ev.hits(["a", "b", "c", "d", "e", "f"], ["z", "c"])
        self.assertEqual((r["l1"], r["l3"], r["l5"]), (0, 1, 1))
        self.assertEqual((r["s1"], r["s5"]), (0, 0))  # the first accepted concept, z, is not in the list
        r = ev.hits(["z", "a"], ["z", "c"])
        self.assertEqual((r["s1"], r["l1"]), (1, 1))

    def test_rank_codes_best_name_per_concept_ties_go_to_the_shorter_name_and_zero_is_dropped(self):
        import numpy as np
        ranked = ev.rank_codes(np.array([0.2, 0.9, 0.5]), ["x", "y", "x"])
        self.assertEqual(ranked, ["y", "x"])  # y first; x once, at its best score 0.5
        tie = ev.rank_codes(np.array([0.7, 0.7]), ["long", "short"], ["a much longer name", "short"])
        self.assertEqual(tie, ["short", "long"])  # not the order of the list
        self.assertEqual(ev.rank_codes(np.array([0.0, 0.3]), ["a", "b"], None, True), ["b"])

    def test_counts_wrong_and_missing_answers(self):
        gold = [{"slots": {"severity": "1", "laterality": "2"}}, {"slots": {}}]
        preds = [{"severity": "1", "laterality": "9"}, {"pattern": "5"}]
        tp, fp, fn = ev.counts(gold, preds, [0, 1])
        self.assertEqual((tp, fp, fn), (1, 2, 1))  # severity right; laterality wrong (a miss and a wrong answer); pattern asked for nothing
        s = ev.prf(tp, fp, fn)
        self.assertEqual((s["precision"], s["recall"]), (33, 50))

    def test_fusion_and_bootstrap(self):
        self.assertEqual(ev.fuse(["a", "b"], ["b", "c"])[0], "b")
        lo, hi = ev.boot_ci([1, 0, 1, 1, 0, 1, 1, 1])
        self.assertTrue(0 <= lo <= hi <= 100)

    def test_the_gold_file_has_only_codes_and_the_fields_the_harness_reads(self):
        import json
        g = json.loads((HERE / "fixtures" / "gold-two-step.json").read_text(encoding="utf8"))["items"]
        self.assertGreaterEqual(len(g), 50)
        for item in g:
            self.assertIn(item["lang"], ("sv", "en"))
            self.assertTrue(item["finding"] and all(c.isdigit() for c in item["finding"]))
            self.assertTrue(all(c.isdigit() for c in item["slots"].values()))
            self.assertIsInstance(item["wordlist_knows_it"], bool)


if __name__ == "__main__":
    unittest.main()
