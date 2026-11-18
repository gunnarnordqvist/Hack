"""The local server must serve only web/ and its three API routes. Raw request paths are sent with http.client, which (unlike a
browser) does not normalise '..', so this tests the server's own path handling."""
import http.client
import os
import sys
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "backend"))
os.environ.setdefault("PENPAD_CACHE", tempfile.mkdtemp())

from server import make_handler  # noqa: E402
from tx import Tx  # noqa: E402


class StubRanker:
    model_name = "stub"
    has_model = False
    universe = {}

    def candidates(self, q, mode="rerank", k=5):
        return {"query": q, "items": [], "low_confidence": True}


class ServerPaths(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(Tx(offline=True), StubRanker()))
        cls.port = cls.srv.server_address[1]
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def get(self, path):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        c.request("GET", path)
        r = c.getresponse()
        return r.status, r.read()

    def test_traversal_with_dotdot_is_refused(self):
        for p in ["/../backend/tx.py", "/../../etc/passwd", "/web/../../backend/tx.py", "/%2e%2e/backend/tx.py", "/..%2fbackend/tx.py"]:
            status, body = self.get(p)
            self.assertIn(status, (403, 404), p)
            self.assertNotIn(b"class Tx", body, p)
            self.assertNotIn(b"root:", body, p)

    def test_absolute_path_is_refused(self):
        status, body = self.get("//etc/passwd")
        self.assertIn(status, (403, 404))
        self.assertNotIn(b"root:", body)

    def test_the_site_itself_is_served(self):
        status, body = self.get("/index.html")
        self.assertEqual(status, 200)
        self.assertIn(b"<main", body)

    def test_health_and_validate_input_checks(self):
        self.assertEqual(self.get("/api/health")[0], 200)
        self.assertEqual(self.get("/api/validate?code=abc")[0], 400)
        self.assertEqual(self.get("/api/validate?code=1%3Bdrop")[0], 400)


if __name__ == "__main__":
    unittest.main()
