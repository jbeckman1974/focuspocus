"""Smoke the actual target process, reporting only public runtime identities."""

from importlib import metadata
import json
import platform
from pathlib import Path
import sys
from zoneinfo import ZoneInfo

import psycopg.pq


def main() -> None:
    release = platform.freedesktop_os_release()
    assert release["ID"] == "opensuse-tumbleweed", release.get("ID")
    license_text = Path("/usr/share/licenses/focuspocus/LICENSE").read_text()
    assert "Version 3, 29 June 2007" in license_text and "END OF TERMS AND CONDITIONS" in license_text
    assert sys.version_info[:3] == (3, 13, 18), sys.version
    assert sys.prefix == "/opt/venv", sys.prefix
    assert platform.machine() in {"x86_64", "aarch64"}, platform.machine()
    assert psycopg.pq.__impl__ == "binary", psycopg.pq.__impl__
    assert ZoneInfo("America/New_York").key == "America/New_York"
    versions = {name: metadata.version(name) for name in
                ("Django", "djangorestframework", "gunicorn", "psycopg", "tzdata")}
    report = {
        "os": release["ID"], "snapshot": release["VERSION_ID"],
        "machine": platform.machine(), "python": platform.python_version(),
        "libpq": psycopg.pq.version(), "packages": versions,
    }
    print(json.dumps(report, sort_keys=True))


if __name__ == "__main__":
    main()
