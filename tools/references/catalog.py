"""Trusted project documentation sources."""

import csv
import re
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit


CATALOG = Path(__file__).with_name("sources.tsv")


@dataclass(frozen=True)
class Source:
    id: str
    title: str
    url: str

    @property
    def extension(self) -> str:
        return ".pdf" if urlsplit(self.url).path.endswith(".pdf") else ".html"


def public_https_host(url: str) -> str:
    parts = urlsplit(url)
    if (
        parts.scheme != "https"
        or not parts.hostname
        or parts.username is not None
        or parts.password is not None
        or parts.port not in (None, 443)
        or any(c.isspace() for c in url)
    ):
        raise ValueError("Public HTTPS URL required")
    return parts.hostname


def read_catalog() -> list[Source]:
    with CATALOG.open(encoding="utf-8", newline="") as stream:
        reader = csv.DictReader(stream, delimiter="\t")
        if reader.fieldnames != ["id", "title", "url"]:
            raise ValueError("Unexpected source catalog header")
        sources = [Source(**row) for row in reader]
    ids = set()
    for source in sources:
        if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", source.id) or source.id in ids:
            raise ValueError(f"Invalid or duplicate catalog ID: {source.id}")
        if not source.title.strip():
            raise ValueError(f"Missing title for {source.id}")
        public_https_host(source.url)
        ids.add(source.id)
    return sources
