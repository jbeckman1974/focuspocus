"""Seal a pg_dump stream and authenticate a retrieved archive before releasing cleartext."""

import argparse
from contextlib import contextmanager
from functools import lru_cache
import hashlib
import hmac
import os
from pathlib import Path
import re
import shutil
import sys
import subprocess
import tempfile


@lru_cache(maxsize=1)
def openssl_binary():
    configured = os.environ.get("FOCUSPOCUS_OPENSSL")
    candidates = [configured] if configured else [shutil.which("openssl")]
    if not configured and sys.platform == "darwin":
        candidates.extend(["/opt/homebrew/opt/openssl@3/bin/openssl", "/usr/local/opt/openssl@3/bin/openssl"])
    for binary in candidates:
        if binary and shutil.which(binary):
            version = subprocess.run([binary, "version"], capture_output=True, text=True, check=True).stdout
            if re.match(r"OpenSSL [3-9]\.", version):
                return binary
    raise ValueError("Recovery requires OpenSSL 3 or newer. Set FOCUSPOCUS_OPENSSL to its executable.")


def openssl(*args):
    return [openssl_binary(), *map(str, args)]


def checksum(source):
    digest = hashlib.sha256()
    for block in iter(lambda: source.read(1024 * 1024), b""):
        digest.update(block)
    return digest.hexdigest()


@contextmanager
def new_file(path):
    """Publish a complete owner-only file without replacing an existing destination."""
    parent = path.parent
    if parent.is_symlink() or parent.stat().st_uid != os.geteuid() or parent.stat().st_mode & 0o077:
        raise ValueError("Choose an operator-owned private output directory with mode 0700.")
    with tempfile.NamedTemporaryFile(dir=parent) as staged:
        yield staged
        staged.flush()
        os.fsync(staged.fileno())
        os.link(staged.name, path)


def seal(cert, destination, dump_command):
    if not dump_command:
        raise ValueError("Supply the complete dump-producing command.")
    with new_file(destination) as encrypted:
        with subprocess.Popen(dump_command, stdout=subprocess.PIPE) as dump:
            try:
                subprocess.run(openssl(
                    "cms", "-encrypt", "-binary", "-stream", "-outform", "DER", "-aes-256-gcm",
                    "-recip", cert, "-keyopt", "rsa_padding_mode:oaep", "-keyopt", "rsa_oaep_md:sha256",
                ), stdin=dump.stdout, stdout=encrypted, check=True)
            finally:
                dump.stdout.close()
            if dump.wait():
                raise RuntimeError("Dump producer failed. The archive was discarded.")
        encrypted.seek(0)
        digest = checksum(encrypted)
    return digest


def unseal(cert, key, source, expected, destination):
    if not re.fullmatch(r"[0-9a-f]{64}", expected):
        raise ValueError("Supply the trusted ciphertext SHA-256 from the backup record.")
    with source.open("rb") as archive:
        if not hmac.compare_digest(checksum(archive), expected):
            raise ValueError("Encrypted archive checksum mismatch.")
        archive.seek(0)
        with new_file(destination) as clear:
            subprocess.run(openssl(
                "cms", "-decrypt", "-binary", "-inform", "DER", "-recip", cert, "-inkey", key,
            ), stdin=archive, stdout=clear, check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="operation", required=True)
    encrypt = commands.add_parser("seal")
    encrypt.add_argument("certificate", type=Path)
    encrypt.add_argument("destination", type=Path)
    encrypt.add_argument("dump_command", nargs=argparse.REMAINDER)
    decrypt = commands.add_parser("open")
    decrypt.add_argument("certificate", type=Path)
    decrypt.add_argument("private_key", type=Path)
    decrypt.add_argument("source", type=Path)
    decrypt.add_argument("sha256")
    decrypt.add_argument("destination", type=Path)
    args = parser.parse_args()
    if args.operation == "seal":
        command = args.dump_command
        print(seal(args.certificate, args.destination, command[1:] if command[:1] == ["--"] else command))
    else:
        unseal(args.certificate, args.private_key, args.source, args.sha256, args.destination)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        raise SystemExit(str(error)) from None
