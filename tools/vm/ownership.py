"""Match the checkout's owner record to the identity written by Lima on create."""

from pathlib import Path
import os
import re
import tempfile
import uuid


RECORD = "instance-id"
ID = r"fp-[0-9a-f]{32}"


def read_record(state: Path) -> str:
    record = state / RECORD
    if record.is_symlink() or not record.is_file():
        raise ValueError(f"VM ownership could not be established from {record}.")
    value = record.read_text(encoding="ascii").strip()
    if not re.fullmatch(ID, value):
        raise ValueError(f"Invalid VM ownership record at {record}.")
    return value


def reserve(state: Path) -> str:
    record = state / RECORD
    if record.exists() or record.is_symlink():
        return read_record(state)  # Retry a create that stopped before producing an instance.
    value = "fp-" + uuid.uuid4().hex
    # The link publishes a complete record exclusively, before Lima can create the instance.
    with tempfile.NamedTemporaryFile(mode="w", encoding="ascii", dir=state) as staged:
        staged.write(value + "\n")
        staged.flush()
        os.fsync(staged.fileno())
        os.link(staged.name, record)
    return value


def require_owned(state: Path, instance: Path) -> None:
    expected = read_record(state)
    config = instance / "lima.yaml"
    if instance.is_symlink() or config.is_symlink() or not config.is_file():
        raise ValueError(f"Could not verify the instance configuration in {instance}. Preserving it.")
    # Lima persists the guest environment in its YAML. Allow either scalar quote style.
    pattern = r"^\s*FOCUSPOCUS_VM_INSTANCE_ID:\s*['\"]?(" + ID + r")[\"']?\s*$"
    ids = re.findall(pattern, config.read_text(encoding="utf-8"), re.MULTILINE)
    if ids != [expected]:
        raise ValueError(f"Instance {instance} does not match this launcher's ownership record. Preserving it.")


def forget(state: Path) -> None:
    if (state / RECORD).exists() or (state / RECORD).is_symlink():
        read_record(state)
        (state / RECORD).unlink()
