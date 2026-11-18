"""The built public site must be self-contained: every module that a page or module imports is part of the build, and the
site carries no SNOMED CT snapshot."""
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class SiteBuild(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.out = Path(cls.tmp.name) / "site"
        subprocess.run([sys.executable, str(ROOT / "tools" / "build_site.py"), str(cls.out)], check=True, capture_output=True)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_every_relative_import_exists(self):
        missing = []
        for f in self.out.rglob("*.js"):
            for m in re.finditer(r'(?:import|export)[^;\n]*?from\s+"(\.{1,2}/[^"]+)"|import\("(\.{1,2}/[^"]+)"\)', f.read_text(encoding="utf8")):
                target = (f.parent / (m.group(1) or m.group(2))).resolve()
                if not target.exists():
                    missing.append(f"{f.relative_to(self.out)} imports {m.group(1) or m.group(2)}")
        self.assertEqual(missing, [])

    def test_the_page_loads_only_files_that_exist(self):
        html = (self.out / "index.html").read_text(encoding="utf8")
        for ref in re.findall(r'(?:src|href)="([^":]+)"', html):
            if ref.startswith(("http", "#", "//")):
                continue
            self.assertTrue((self.out / ref).exists(), ref)

    def test_no_snapshot_and_a_config_file(self):
        self.assertFalse((self.out / "data" / "snapshot.json").exists())
        self.assertTrue((self.out / "data" / "config.json").exists())
        self.assertTrue((self.out / "THIRD_PARTY_NOTICES.md").exists())

    def test_version_file(self):
        import json
        v = json.loads((self.out / "version.json").read_text(encoding="utf8"))
        self.assertIn("commit", v)
        self.assertIn("built", v)


if __name__ == "__main__":
    unittest.main()
