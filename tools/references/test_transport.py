import io
import time
import unittest
from email.message import Message
from unittest.mock import Mock, patch
from urllib.error import HTTPError
from urllib.request import Request

from catalog import Source, public_https_host, read_catalog
from transport import CatalogRedirects, make_fetcher, read_page


GUIDE = Source("guide", "Guide", "https://docs.example.invalid/guide#chapter")
PDF = Source("document", "Document", "https://docs.example.invalid/document.pdf")


class Response(io.BytesIO):
    def __init__(self, data, content_type="text/html", headers=None, status=200):
        super().__init__(data)
        self.headers = Message()
        self.headers["Content-Type"] = content_type
        for key, value in (headers or {}).items():
            self.headers[key] = value
        self.status = status

    def geturl(self):
        return "https://docs.example.invalid/edition"


class TransportTests(unittest.TestCase):
    def test_catalog_covers_baseline_sources_and_technical_references(self):
        catalog = read_catalog()
        by_id = {source.id: source for source in catalog}
        self.assertEqual(len(catalog), len(by_id))
        for chapter in ("capture", "commands", "custom-perspectives", "database", "glossary",
                        "inspector", "outline", "perspectives", "settings", "system", "web"):
            self.assertEqual(
                by_id[f"omnifocus-{chapter}"].url,
                f"https://support.omnigroup.com/documentation/omnifocus/universal/4.10.1/en/{chapter}/",
            )
        self.assertEqual(by_id["copyright-circular-61"].extension, ".pdf")
        for entry in ("docker-platforms", "github-runners", "opensuse-cloud", "lima-arch"):
            self.assertIn(entry, by_id)

    def test_public_urls_and_redirects_stay_on_catalog_https_hosts(self):
        redirect = CatalogRedirects({"docs.example.invalid"})
        request = Request(GUIDE.url)
        for target in ("http://docs.example.invalid/", "https://docs.example.invalid:81/",
                       "https://unused@docs.example.invalid/", "https://other.example.invalid/"):
            with self.subTest(target=target):
                with Response(b"") as response:
                    with self.assertRaises(ValueError):
                        redirect.redirect_request(request, response, 302, "", {}, target)
                    self.assertTrue(response.closed)
        target = "https://docs.example.invalid/second-edition"
        with Response(b"") as response:
            result = redirect.redirect_request(request, response, 302, "", {}, target)
        self.assertEqual(public_https_host(result.full_url), "docs.example.invalid")

    def test_content_types_lengths_and_completion_are_checked(self):
        deadline = time.monotonic() + 10
        with Response(b"<html>complete</html>", headers={"Content-Length": "21"}) as response:
            page = read_page(response, GUIDE, deadline)
        self.assertEqual(page.data, b"<html>complete</html>")
        self.assertEqual(page.resolved_url, response.geturl())
        with Response(b"%PDF-sample", "application/octet-stream") as response:
            self.assertEqual(read_page(response, PDF, deadline).data, b"%PDF-sample")
        failures = [
            (GUIDE, Response(b""), "Incomplete"),
            (GUIDE, Response(b"x", headers={"Content-Length": "8"}), "Incomplete"),
            (GUIDE, Response(b"x", headers={"Content-Length": "0"}), "length"),
            (GUIDE, Response(b"x", headers={"Content-Encoding": "gzip"}), "compressed"),
            (GUIDE, Response(b"x", "image/png"), "type"),
            (GUIDE, Response(b"<!--partial-->", status=206), "status"),
            (PDF, Response(b"not PDF", "application/pdf"), "signature"),
        ]
        for source, response, reason in failures:
            with self.subTest(reason=reason), response:
                with self.assertRaisesRegex(ValueError, reason):
                    read_page(response, source, deadline)

    def test_size_cap_applies_to_streamed_and_declared_responses(self):
        deadline = time.monotonic() + 10
        with patch("transport.MAX_BYTES", 4):
            for headers in ({}, {"Content-Length": "5"}):
                with self.subTest(headers=headers), Response(b"12345", headers=headers) as response:
                    with self.assertRaisesRegex(ValueError, "limit"):
                        read_page(response, GUIDE, deadline)
            with Response(b"1234") as response:
                self.assertEqual(read_page(response, GUIDE, deadline).data, b"1234")

    def test_expired_read_deadline_fails(self):
        with Response(b"page") as response:
            with self.assertRaisesRegex(TimeoutError, "deadline"):
                read_page(response, GUIDE, time.monotonic() - 1)

    def test_fetcher_retries_transient_failure_and_strips_fragment(self):
        failure = HTTPError(GUIDE.url, 503, "temporarily unavailable", {}, io.BytesIO())
        opener = Mock()
        opener.open.side_effect = [failure, Response(b"edition")]
        with patch("transport.build_opener", return_value=opener), patch("transport.time.sleep"):
            fetch = make_fetcher([GUIDE])
            self.assertEqual(fetch(GUIDE).data, b"edition")
            for call in opener.open.call_args_list:
                request = call.args[0]
                self.assertEqual(request.full_url, "https://docs.example.invalid/guide")
                self.assertGreater(call.kwargs["timeout"], 0)
            self.assertEqual(opener.open.call_count, 2)
            with self.assertRaisesRegex(ValueError, "Unlisted"):
                fetch(Source("another", "Another", "https://docs.example.invalid/unspecified"))
            self.assertEqual(opener.open.call_count, 2)

    def test_permanent_failure_is_not_retried(self):
        failure = HTTPError(GUIDE.url, 404, "missing", {}, io.BytesIO())
        opener = Mock()
        opener.open.side_effect = failure
        with patch("transport.build_opener", return_value=opener):
            with self.assertRaises(HTTPError):
                make_fetcher([GUIDE])(GUIDE)
        self.assertEqual(opener.open.call_count, 1)
