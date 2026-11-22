"""Get the Tumbleweed cloud disk and verify openSUSE's signature and SHA-256."""

import hashlib
from pathlib import Path
import re
import subprocess
import tempfile


NAME = "openSUSE-Tumbleweed-Minimal-VM.x86_64-Cloud.qcow2"
URL = "https://download.opensuse.org/tumbleweed/appliances/" + NAME
# Published together on https://get.opensuse.org/tumbleweed/ under Verify your download.
SIGNER = "AD485664E901B867051AB15F35A2F86E29B700A4"
KEY = "https://download.opensuse.org/tumbleweed/repo/oss/gpg-pubkey-29b700a4-6a17fa38.asc"
MAX_IMAGE_BYTES = 2 * 1024**3


def fetch(url: str, path: Path, seconds: int, max_bytes: int) -> None:
    subprocess.run([
        "curl", "--disable", "--fail", "--silent", "--show-error", "--location",
        "--proto", "=https", "--proto-redir", "=https", "--connect-timeout", "20",
        "--retry", "2", "--retry-max-time", str(seconds), "--max-time", str(seconds),
        "--speed-limit", "1024", "--speed-time", "90", "--max-filesize", str(max_bytes),
        "--output", str(path), url,
    ], check=True)


def require_signer(status: str) -> None:
    rows = [line.split() for line in status.splitlines() if line.startswith("[GNUPG:] ")]
    invalid = {"BADSIG", "ERRSIG", "EXPSIG", "EXPKEYSIG", "REVKEYSIG", "KEYEXPIRED", "SIGEXPIRED"}
    if any(row[1] in invalid for row in rows if len(row) >= 2):
        raise ValueError("openSUSE checksum signature is invalid, expired, or revoked.")
    # VALIDSIG identifies the signing key first and its primary fingerprint last for a subkey.
    if not any(len(row) >= 11 and row[1] == "VALIDSIG" and SIGNER in (row[2], row[-1]) for row in rows):
        raise ValueError("Checksum signature was not verified with the published Tumbleweed signing key.")


def signed_checksum(cache: Path) -> str:
    with tempfile.TemporaryDirectory(dir=cache) as work:
        private = Path(work)
        manifest = private / "image.sha256"
        signature = private / "image.sha256.asc"
        key = private / "publisher.asc"
        fetch(KEY, key, 120, 128 * 1024)
        fetch(URL + ".sha256", manifest, 120, 4096)
        fetch(URL + ".sha256.asc", signature, 120, 16 * 1024)
        gpg = ["gpg", "--no-options", "--batch", "--no-autostart", "--homedir", work]
        subprocess.run([*gpg, "--quiet", "--import", str(key)], check=True)
        status = subprocess.check_output([
            *gpg, "--no-auto-key-retrieve", "--status-fd", "1", "--verify", str(signature), str(manifest)
        ], text=True)
        require_signer(status)
        return checksum(manifest.read_text(encoding="ascii"))


def checksum(manifest: str) -> str:
    match = re.fullmatch(r"([a-fA-F0-9]{64}) [ *]" + re.escape(NAME), manifest.strip())
    if match is None:
        raise ValueError("The openSUSE SHA-256 file did not name the requested cloud image.")
    return match.group(1).lower()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as contents:
        for block in iter(lambda: contents.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def verified_image(cache: Path) -> tuple[Path, str]:
    expected = signed_checksum(cache)
    dest = cache / (expected + ".qcow2")
    if dest.is_symlink():
        raise ValueError(f"Unexpected symbolic link at {dest}")
    if dest.is_file() and sha256(dest) == expected:
        return dest, expected

    # Stage on the same filesystem. A failed transfer leaves the last verified disk intact.
    with tempfile.NamedTemporaryFile(dir=cache, delete=False) as download:
        partial = Path(download.name)
    try:
        fetch(URL, partial, 3600, MAX_IMAGE_BYTES)
        if sha256(partial) != expected:
            raise ValueError("Image checksum mismatch. Re-run up to resolve the rolling snapshot again.")
        partial.replace(dest)
    finally:
        partial.unlink(missing_ok=True)
    return dest, expected
