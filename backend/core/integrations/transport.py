import http.client
import time
from urllib.parse import urlsplit

from .configuration import AdapterError, https_target
from .ical import MAX_BYTES


def transaction(method, target, *, headers=None):
    """Contact one operator-approved HTTPS endpoint without proxies or redirects."""
    if not https_target(target):
        raise AdapterError("provider_address_invalid")
    url = urlsplit(target)
    deadline = time.monotonic() + 12
    conn = http.client.HTTPSConnection(url.hostname, 443, timeout=4)
    try:
        path = url.path or "/"
        if url.query:
            path += "?" + url.query
        conn.request(method, path, body=b"" if method == "POST" else None, headers=headers or {})
        response = conn.getresponse()
        if method != "GET" or response.status != 200:
            return response.status, b""
        buffer = bytearray()
        while len(buffer) <= MAX_BYTES:
            if time.monotonic() >= deadline:
                raise AdapterError("provider_timeout")
            part = response.read1(min(65536, MAX_BYTES + 1 - len(buffer)))
            if not part:
                return response.status, bytes(buffer)
            buffer.extend(part)
        raise AdapterError("calendar_too_large")
    finally:
        conn.close()
