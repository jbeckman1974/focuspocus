"""Reserve the local report paths and retain the previous measurement for comparison."""

import fcntl
from pathlib import Path
import subprocess
from uuid import uuid4


def run():
    output = Path("build/performance")
    if output.is_symlink() or output.parent.is_symlink():
        raise ValueError("Benchmark evidence must stay under build/.")
    output.mkdir(parents=True, exist_ok=True)
    lock_path = output / "run.lock"
    if lock_path.is_symlink():
        raise ValueError("Use a local benchmark lock.")
    with lock_path.open("a") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        artifacts = [output / key for key in ("report.json", "SHA256SUMS")]
        if any(path.is_symlink() for path in artifacts):
            raise ValueError("Evidence files must be local.")
        if any(path.exists() for path in artifacts):
            old = output / ("previous-" + uuid4().hex)
            old.mkdir(mode=0o700)
            for path in artifacts:
                if path.exists():
                    path.rename(old / path.name)
        return subprocess.run(
            ["bash", "ops/performance/isolated-stack.sh", "bash", "ops/performance/measure.sh"],
            pass_fds=(lock.fileno(),),
        ).returncode


if __name__ == "__main__":
    raise SystemExit(run())
