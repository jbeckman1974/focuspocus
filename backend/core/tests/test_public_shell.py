import tempfile
from pathlib import Path

from django.test import SimpleTestCase, override_settings


class PublicShellTests(SimpleTestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        (self.root / "app").mkdir()
        (self.root / "assets").mkdir()
        self.enterContext(override_settings(SPA_ROOT=self.root))

    def test_serves_only_known_public_shell_artifacts(self):
        for filename, media in (("sw.js", "text/javascript"), ("icon-192.png", "image/png"),
                                ("manifest.webmanifest", "application/manifest+json"),
                                ("third-party-licenses.json", "application/json")):
            (self.root / "app" / filename).write_bytes(b"public fixture")
            response = self.client.get("/app/" + filename)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response["Content-Type"], media)
            self.assertIn("no-cache", response["Cache-Control"])
            self.assertEqual(b"".join(response.streaming_content), b"public fixture")
        (self.root / "app" / "private.txt").write_bytes(b"separate fixture")
        self.assertEqual(self.client.get("/app/private.txt").status_code, 404)
        self.assertEqual(self.client.post("/app/sw.js").status_code, 405)

    def test_older_notification_worker_keeps_serving_generic_push_script(self):
        (self.root / "app" / "legacy-push.js").write_bytes(b"generic push")
        legacy = "notification-worker-A3456789.js"
        response = self.client.get("/assets/" + legacy)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(b"".join(response.streaming_content), b"generic push")
        (self.root / "assets" / legacy).write_bytes(b"exact build bytes")
        response = self.client.get("/assets/" + legacy)
        self.assertEqual(b"".join(response.streaming_content), b"exact build bytes")
        self.assertEqual(self.client.get("/assets/missing-A3456789.js").status_code, 404)
