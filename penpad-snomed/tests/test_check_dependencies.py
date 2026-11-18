"""The dependency checker must be able to fail: unpinned requirements and unpinned Actions are caught."""
import re
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "tools"))

import check_dependencies as cd  # noqa: E402


class Checker(unittest.TestCase):
    def test_unpinned_requirement_is_a_problem(self):
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / "requirements-x.txt"
            f.write_text("foo>=1.0\nbar==2.0\n# comment\n\n", encoding="utf8")
            reqs, problems = cd.requirements(f)
        self.assertEqual(reqs, {"bar": "2.0"})
        self.assertEqual(len(problems), 1)
        self.assertIn("foo>=1.0", problems[0])

    def test_names_are_normalised(self):
        self.assertEqual(cd.norm("Sentence_Transformers"), cd.norm("sentence-transformers"))

    def test_the_real_project_passes(self):
        self.assertEqual(cd.main(), 0)

    def test_every_action_in_the_workflow_is_pinned_to_a_commit(self):
        wf = (HERE.parent.parent / ".github" / "workflows" / "pages.yml").read_text(encoding="utf8")
        refs = re.findall(r"uses:\s*[^@\s]+@(\S+)", wf)
        self.assertTrue(refs)
        for r in refs:
            self.assertRegex(r, r"^[0-9a-f]{40}$")


if __name__ == "__main__":
    unittest.main()
