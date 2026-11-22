"""Save project reference documents in build/OmniFocus. Requires Python 3.9+."""

import argparse
import fcntl
import hashlib
import html
import http.client
import json
import os
import socket
import sys
import tempfile
from contextlib import contextmanager
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import URLError

from catalog import Source, public_https_host, read_catalog
from transport import Page, make_fetcher


PROJECT = Path(__file__).resolve().parents[2]
DESTINATION = PROJECT / "build" / "OmniFocus"
MARKER = ".focuspocus-reference-archive-v1"


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def atomic_write(path: Path, data: bytes) -> None:
    if path.is_symlink():
        raise ValueError(f"Refusing symbolic link: {path.name}")
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as stream:
        temporary = Path(stream.name)
        try:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
            stream.close()
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)


@contextmanager
def locked_archive(root: Path):
    if root.parent.is_symlink() or root.is_symlink():
        raise ValueError("Archive location must be a real project directory")
    root.mkdir(parents=True, exist_ok=True)
    marker = root / MARKER
    if marker.is_symlink():
        raise ValueError("Refusing linked ownership marker")
    if not marker.exists():
        for name in ("copies", "manifest.json", "index.html"):
            if os.path.lexists(root / name):
                raise ValueError(f"Unmanaged {name} exists in the archive directory")
    with marker.open("a+") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise ValueError("Another reference download is in progress") from error
        copies = root / "copies"
        if copies.is_symlink():
            raise ValueError("Refusing linked copies directory")
        copies.mkdir(exist_ok=True)
        yield


def capture_path(root: Path, source: Source, digest: str) -> Path:
    if len(digest) != 64 or any(char not in "0123456789abcdef" for char in digest):
        raise ValueError("Invalid SHA-256 in archive manifest")
    return root / "copies" / f"{source.id}-{digest}{source.extension}"


def verify_file(path: Path, length: int, digest: str) -> None:
    if path.is_symlink() or not path.is_file() or path.stat().st_size != length:
        raise ValueError(f"Copy has changed: {path.name}")
    with path.open("rb") as stream:
        checksum = hashlib.sha256()
        for block in iter(lambda: stream.read(65536), b""):
            checksum.update(block)
    if checksum.hexdigest() != digest:
        raise ValueError(f"Copy has changed: {path.name}")


class ReleaseText(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []

    def handle_data(self, data):
        self.parts.append(data)


def save_page(root: Path, source: Source, page: Page) -> dict:
    if source.id == "omnifocus-release-notes":
        release = ReleaseText()
        release.feed(page.data.decode("utf-8", errors="replace"))
        release.close()
        words = " ".join(" ".join(release.parts).split())
        if "OmniFocus for Mac 4.10.1 November 10, 2026" not in words:
            raise ValueError("Release notes do not identify the Mac 4.10.1 baseline and date")
    digest = hashlib.sha256(page.data).hexdigest()
    path = capture_path(root, source, digest)
    if os.path.lexists(path):
        verify_file(path, len(page.data), digest)
    else:
        atomic_write(path, page.data)
    return {
        "requested_url": source.url,
        "resolved_url": page.resolved_url,
        "captured_utc": now(),
        "content_type": page.content_type,
        "bytes": len(page.data),
        "sha256": digest,
        "file": path.relative_to(root).as_posix(),
    }


def load_records(root: Path) -> dict:
    path = root / "manifest.json"
    if path.is_symlink():
        raise ValueError("Refusing linked manifest")
    if not path.exists():
        return {}
    manifest = json.loads(path.read_text(encoding="utf-8"))
    if manifest.get("format_version") != 1 or not isinstance(manifest.get("sources"), dict):
        raise ValueError("Unrecognized archive manifest")
    return manifest["sources"]


def index_html(root: Path, sources: list[Source], records: dict) -> bytes:
    upstream = root / "upstream" / "index.html"
    repository_link = ""
    if not upstream.parent.is_symlink() and not upstream.is_symlink() and upstream.is_file():
        repository_link = '<p><a href="upstream/index.html">Documentation from publisher source repositories</a></p>'
    rows = []
    for source in sources:
        record = records[source.id]
        title = html.escape(source.title)
        url = html.escape(source.url, quote=True)
        status = html.escape(record["status"])
        copies = []
        for capture in reversed(record["captures"]):
            date = html.escape(capture["captured_utc"])
            path = capture_path(root, source, capture["sha256"])
            try:
                verify_file(path, capture["bytes"], capture["sha256"])
            except (ValueError, OSError):
                copies.append(f"{date} (unavailable)")
            else:
                filename = html.escape(path.relative_to(root).as_posix(), quote=True)
                copies.append(f'<a href="{filename}">{date}</a>')
        history = "<br>".join(copies) or "—"
        detail = html.escape(record.get("error", ""))
        rows.append(f'<tr><td><a href="{url}">{title}</a></td><td>{history}</td><td>{status} {detail}</td></tr>')
    body = "".join(rows)
    return (
        '<!doctype html><html lang="en"><meta charset="utf-8"><title>Project references</title>'
        '<style>body{font:1rem system-ui;max-width:75rem;margin:2rem auto;padding:0 1rem}'
        'td,th{text-align:left;vertical-align:top;padding:.45rem;border-bottom:1px solid #ccc}'
        'caption{text-align:left;font-weight:bold;padding:.6rem 0}</style><main><h1>Project references</h1>'
        '<p>Select a capture date to open a saved document. The publisher link opens the source. '
        'Times are UTC. File sizes and SHA-256 checksums are in <a href="manifest.json">manifest.json</a>.</p>'
        f'{repository_link}'
        '<table><caption>Documentation inventory</caption><thead><tr><th>Publisher source</th>'
        '<th>Local captures</th><th>Last result</th></tr></thead>'
        f'<tbody>{body}</tbody></table></main></html>'
    ).encode("utf-8")


def inventory(root: Path, sources: list[Source], fetch, refresh=False) -> int:
    """Return the number of unsuccessful sources. Complete other publishers after a failure."""
    with locked_archive(root):
        records = load_records(root)
        failed_hosts = set()
        failures = 0
        for source in sources:
            state = records.setdefault(source.id, {"captures": []})
            state.update(title=source.title, url=source.url, checked_utc=now())
            state.pop("error", None)
            host = public_https_host(source.url)
            available = False
            try:
                previous = next(
                    (item for item in reversed(state["captures"]) if item["requested_url"] == source.url),
                    None,
                )
                if previous:
                    path = capture_path(root, source, previous["sha256"])
                    if os.path.lexists(path):
                        verify_file(path, previous["bytes"], previous["sha256"])
                        available = True
                if available and not refresh:
                    state["status"] = "Verified local copy"
                else:
                    if host in failed_hosts:
                        raise ConnectionError(f"DNS unavailable for {host} during this run")
                    capture = save_page(root, source, fetch(source))
                    if not previous or previous["sha256"] != capture["sha256"]:
                        state["captures"].append(capture)
                    state["status"] = "Downloaded"
            except (OSError, ValueError, http.client.HTTPException) as error:
                if isinstance(error, URLError) and isinstance(error.reason, socket.gaierror):
                    failed_hosts.add(host)
                state["error"] = str(error)
                state["status"] = "Refresh failed (previous copy verified)" if available else "Unavailable"
                failures += 1
            results = {"format_version": 1, "sources": records}
            atomic_write(root / "manifest.json", (json.dumps(results, indent=2) + "\n").encode("utf-8"))
        atomic_write(root / "index.html", index_html(root, sources, records))
    return failures


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh", action="store_true", help="request a fresh copy of each source")
    args = parser.parse_args()
    try:
        sources = read_catalog()
        failures = inventory(DESTINATION, sources, make_fetcher(sources), args.refresh)
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f"Reference archive: {error}", file=sys.stderr)
        return 1
    print(f"{len(sources) - failures}/{len(sources)} source checks succeeded. Index: {DESTINATION / 'index.html'}")
    return int(bool(failures))


if __name__ == "__main__":
    sys.exit(main())
