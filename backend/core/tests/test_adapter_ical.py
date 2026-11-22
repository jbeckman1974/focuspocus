import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from unittest import TestCase
from unittest.mock import patch

from core.integrations import ical, transport
from core.integrations.configuration import AdapterError


def feed(*lines):
    return ("\r\n".join(("BEGIN:VCALENDAR", "VERSION:2.0", *lines, "END:VCALENDAR", ""))).encode()


def event(*lines):
    return ("BEGIN:VEVENT", *lines, "END:VEVENT")


def fixture(summary="Crew visit", sequence=0):
    return feed(*event("UID:alpha", "DTSTART:20261122T050000Z", "DTEND:20261122T060000Z",
                       f"SUMMARY:{summary}", f"SEQUENCE:{sequence}"),
                *event("UID:days", "DTSTART;VALUE=DATE:20261121", "DTEND;VALUE=DATE:20261123",
                       r"SUMMARY:Two\, days"))


class CalendarFormatTests(TestCase):
    def test_zones_folding_exceptions_cancellation_and_boundaries(self):
        items = ical.parse(feed(*event("UID:series", "RECURRENCE-ID:20261101T120000Z",
                                       "DTSTART;TZID=America/New_York:20261122T090000", "SUMMARY:Field",
                                       " visit"), *event("UID:old", "DTSTART;VALUE=DATE:20261122"),
                                *event("UID:old", "STATUS:CANCELLED", "SEQUENCE:2")))
        self.assertEqual(len(items), 1)
        self.assertEqual((items[0]["title"], items[0]["start"]), ("Fieldvisit", "2026-11-22T14:00:00+00:00"))
        self.assertNotEqual(items[0]["key"], ical.parse(fixture())[0]["key"])
        self.assertEqual(ical.parse(feed(*event("UID:day", "DTSTART;VALUE=DATE:20261122")))[0]["end"], "2026-11-23")
        for example in (b"", b"BEGIN:VCALENDAR\n", b"\x00", b"x" * (ical.MAX_BYTES + 1),
                        feed(*event("DTSTART:20261122T050000Z")), feed(*event("UID:bad", "DTSTART:bad")),
                        feed(*event("UID:e", "DTSTART:20261122T050000Z", "EXRULE:FREQ=DAILY"))):
            with self.subTest(length=len(example)), self.assertRaises(AdapterError):
                ical.parse(example)


class CalendarHTTPFixture(TestCase):
    """Real local HTTP transport with a fixed upstream response; the production client remains HTTPS-only."""

    def test_bounded_fetch_and_redirect(self):
        fixture_bytes = fixture()
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                if self.path == "/moved":
                    self.send_response(302)
                    self.send_header("Location", "https://unlisted.invalid/")
                    self.end_headers()
                    return
                self.send_response(200)
                self.end_headers()
                self.wfile.write(fixture_bytes)
            def log_message(self, *args):
                pass
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(lambda: thread.join(2))
        self.addCleanup(server.shutdown)
        def test_connection(host, port, timeout):
            self.assertEqual((host, port), ("fixture.invalid", 443))
            return http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=timeout)
        with patch("core.integrations.transport.http.client.HTTPSConnection", side_effect=test_connection):
            self.assertEqual(transport.transaction("GET", "https://fixture.invalid/calendar"), (200, fixture_bytes))
            self.assertEqual(transport.transaction("GET", "https://fixture.invalid/moved"), (302, b""))
            with self.assertRaises(AdapterError):
                transport.transaction("GET", "http://fixture.invalid/calendar")
