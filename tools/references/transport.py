"""Bounded HTTPS GETs for the checked-in documentation catalog."""

import http.client
import socket
import time
from dataclasses import dataclass
from urllib.error import HTTPError, URLError
from urllib.parse import urldefrag
from urllib.request import HTTPRedirectHandler, Request, build_opener

from catalog import Source, public_https_host


MAX_BYTES = 16 * 1024 * 1024
TIMEOUT_SECONDS = 8
READ_DEADLINE_SECONDS = 35


@dataclass(frozen=True)
class Page:
    data: bytes
    resolved_url: str
    content_type: str


class CatalogRedirects(HTTPRedirectHandler):
    max_redirections = 4

    def __init__(self, hosts):
        self.hosts = hosts

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        try:
            if public_https_host(newurl) not in self.hosts:
                raise ValueError("Redirect left the catalog's HTTPS publishers")
        except ValueError:
            fp.close()
            raise
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def read_page(response, source: Source, deadline: float) -> Page:
    if response.status != 200:
        raise ValueError(f"Unexpected HTTP status {response.status}")
    media_type = response.headers.get_content_type()
    allowed_types = (
        {"application/pdf", "application/octet-stream"}
        if source.extension == ".pdf"
        else {"text/html", "application/xhtml+xml"}
    )
    if media_type not in allowed_types:
        raise ValueError(f"Unexpected content type {media_type}")
    if response.headers.get("Content-Encoding", "identity").lower() != "identity":
        raise ValueError("Unexpected compressed response")
    declared = response.headers.get("Content-Length")
    if declared is not None and not (0 < int(declared) <= MAX_BYTES):
        raise ValueError("Content length exceeds the archive limit or is empty")

    data = bytearray()
    while True:
        if time.monotonic() >= deadline:
            raise TimeoutError("Download deadline exceeded")
        chunk = response.read1(min(65536, MAX_BYTES + 1 - len(data)))
        if not chunk:
            break
        data.extend(chunk)
        if len(data) > MAX_BYTES:
            raise ValueError("Response exceeds the archive limit")
    if not data or (declared is not None and len(data) != int(declared)):
        raise ValueError("Incomplete response")
    if source.extension == ".pdf" and not data.startswith(b"%PDF-"):
        raise ValueError("Invalid PDF signature")
    return Page(bytes(data), response.geturl(), media_type)


def make_fetcher(sources):
    urls = {source.url for source in sources}
    hosts = {public_https_host(url) for url in urls}
    opener = build_opener(CatalogRedirects(hosts))

    def fetch(source: Source) -> Page:
        if source.url not in urls:
            raise ValueError("Unlisted documentation URL")
        req = Request(
            urldefrag(source.url).url,
            headers={"User-Agent": "FocusPocus-ReferenceArchive/1.0", "Accept-Encoding": "identity"},
        )
        for attempt in range(2):
            try:
                deadline = time.monotonic() + READ_DEADLINE_SECONDS
                with opener.open(req, timeout=TIMEOUT_SECONDS) as response:
                    return read_page(response, source, deadline)
            except HTTPError as error:
                error.close()
                if attempt or error.code not in {408, 500, 502, 503, 504}:
                    raise
            except (URLError, TimeoutError, http.client.IncompleteRead) as error:
                if attempt or isinstance(getattr(error, "reason", None), socket.gaierror):
                    raise
            time.sleep(0.5)
        raise RuntimeError("Unreachable download state")

    return fetch
