"""Read optional operator-controlled adapters. Never return credentials to browser clients."""

import json
import os
import re
from pathlib import Path
from urllib.parse import urlsplit


class AdapterError(Exception):
    """A stable, public error code. Transport exceptions may contain private URLs."""


def configuration():
    path = os.environ.get("FOCUSPOCUS_INTEGRATIONS_FILE")
    if not path:
        return {}
    try:
        with Path(path).open("rb") as stream:
            raw = stream.read(64 * 1024 + 1)
        if len(raw) <= 64 * 1024:
            data = json.loads(raw)
            if isinstance(data, dict):
                return data
    except (OSError, ValueError):
        pass
    raise AdapterError("adapter_configuration")


def https_target(value):
    try:
        if not isinstance(value, str) or len(value) > 4096 or any(c.isspace() or ord(c) < 32 for c in value):
            return False
        url = urlsplit(value)
        return (url.scheme == "https" and bool(url.hostname) and url.username is None
                and url.password is None and not url.fragment and url.port in (443, None))
    except ValueError:
        return False


def sources(user):
    entries = configuration().get("calendars", {})
    if not isinstance(entries, dict) or len(entries) > 128:
        raise AdapterError("adapter_configuration")
    return {key: entry for key, entry in entries.items()
            if isinstance(key, str) and re.fullmatch(r"[\w.-]{1,80}", key, re.ASCII)
            and isinstance(entry, dict) and entry.get("username") == user.get_username()
            and https_target(entry.get("url")) and isinstance(entry.get("label"), str)
            and 0 < len(entry["label"]) <= 120}
