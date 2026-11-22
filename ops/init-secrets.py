"""Create strictly project-local secret files for Compose without rotating existing values."""

import argparse
import os
import secrets
import stat
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NAMES = ("database-admin", "database-migrate", "database-app", "django-key")


def initialize(destination: Path) -> None:
    directory = destination.absolute()
    build = ROOT / "build"
    if not directory.is_relative_to(build) or directory == build:
        raise ValueError("Use a dedicated directory under the project's build folder.")
    if directory.resolve() != directory or ".." in directory.parts:
        raise ValueError("The secret directory cannot contain symbolic links or parent traversal.")
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = directory.stat()
    if info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700:
        raise ValueError("The secret directory must be private (0700) and owned by this user.")
    for name in NAMES:
        output = directory / name
        if output.is_symlink():
            raise ValueError("Refusing to follow a secret file link.")
        if output.exists():
            if not output.is_file() or not output.stat().st_size:
                raise ValueError("Existing secret is not a nonempty regular file.")
            continue
        # Compose bind-mounts each file. The private parent protects host access while
        # the PostgreSQL and application UIDs can read their explicitly selected mounts.
        with tempfile.NamedTemporaryFile(dir=directory, mode="w") as temp:
            temp.write(secrets.token_urlsafe(48) + "\n")
            temp.flush()
            os.fchmod(temp.fileno(), 0o444)
            try:
                os.link(temp.name, output)
            except FileExistsError:
                if output.is_symlink() or not output.is_file():
                    raise


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path, nargs="?", default=ROOT / "build" / "secrets")
    initialize(parser.parse_args().directory)
