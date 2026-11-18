"""The secret scanner finds what it should, ignores variable references, and the repository itself is clean.
Test strings are assembled from pieces so that this file does not itself look like a secret."""
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "tools"))

import scan_secrets as ss  # noqa: E402


def kinds(text):
    return {k for _, k in ss.scan_text(text)}


class Scanner(unittest.TestCase):
    def test_finds_typical_secrets(self):
        self.assertIn("private key", kinds("-----BEGIN " + "RSA PRIVATE KEY-----"))
        self.assertIn("AWS access key id", kinds("key = " + "AKIA" + "ABCDEFGHIJKLMNOP"))
        self.assertIn("GitHub token", kinds("x " + "ghp_" + "a" * 36))
        self.assertIn("API-style secret assigned to a literal", kinds('API_KEY = "' + "abcdef0123456789" + '"'))
        self.assertIn("URL with embedded credentials", kinds("https://user:" + "hunter2hunter2" + "@example.org/repo"))
        self.assertIn("bearer token", kinds("Authorization: Bearer " + "x" * 30))

    def test_ignores_references_and_ordinary_text(self):
        self.assertEqual(kinds('url="https://x-access-token:${TOKEN}@github.com/${GITHUB_REPOSITORY}.git"'), set())
        self.assertEqual(kinds("TOKEN: ${{ secrets.GITHUB_TOKEN }}"), set())
        self.assertEqual(kinds("token overlap on 5-letter stems"), set())
        self.assertEqual(kinds('const password = process.env.PASSWORD;'), set())

    def test_the_repository_has_no_findings(self):
        root, names = ss.files(staged=False)
        findings = []
        for n in names:
            try:
                text = (root / n).read_text(encoding="utf8")
            except (UnicodeDecodeError, FileNotFoundError, IsADirectoryError):
                continue
            findings += [f"{n}:{line} {kind}" for line, kind in ss.scan_text(text)]
        self.assertEqual(findings, [])


if __name__ == "__main__":
    unittest.main()
