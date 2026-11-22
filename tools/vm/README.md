# Disposable x86_64 openSUSE Tumbleweed VM

Use this guest to rehearse Docker and Compose on the production distribution from an Apple Silicon Mac. QEMU emulates the Intel/AMD instruction set. Daily development uses native ARM64 containers. Releases require application tests and startup/migration checks on native AMD64 GitHub runners, followed by deployment verification on the actual Linux host. [Project operations](../../docs/OPERATIONS.md) · [Lima’s cross-architecture guide](https://lima-vm.io/docs/config/multi-arch/)

## Start from the checkout root

The Mac needs Python 3.9+, Lima 2.3.0+, QEMU with `qemu-system-x86_64`, `qemu-img` and x86_64 UEFI firmware, curl 8.4+, GnuPG (`gpg`) and OpenSSH (`ssh` and `ssh-keygen`) in `PATH`. Lima and QEMU run on the Mac. Docker Engine, its Compose plugin and application dependencies belong inside Linux. Give the guest 4 GiB of memory and room for a 30 GiB sparse system disk plus a cached base image. First boot needs HTTPS access from the Mac to openSUSE and package-repository access inside the guest. [Lima release](https://github.com/lima-vm/lima/releases/tag/v2.3.0) · [Lima installation](https://lima-vm.io/docs/installation/) · [QEMU driver](https://lima-vm.io/docs/config/vmtype/qemu/)

```sh
python3 -B tools/vm/tumbleweed.py doctor
python3 -B tools/vm/tumbleweed.py up
python3 -B tools/vm/tumbleweed.py verify
```

`doctor` checks the host commands and minimum Lima and curl versions. `up` obtains the official Tumbleweed Minimal x86_64 Cloud qcow2, SHA-256 file, detached signature and public key over HTTPS. It verifies the signature in a temporary project-local keyring against the fingerprint published by openSUSE, then verifies the exact image filename and digest. Only then does it pass the local disk and digest to Lima. Review the publisher’s fingerprint and update `cloud_image.py` if openSUSE retires this signing key. [Official appliance and signature index](https://download.opensuse.org/tumbleweed/appliances/) · [openSUSE signing key](https://get.opensuse.org/tumbleweed/)

Each new instance resolves the current rolling image. A running or stopped instance retains its original image. A checksum mismatch can occur when the mirrors switch snapshots. Run `up` again to verify the current manifest and retry. Disk transfers have a 2 GiB limit, a one-hour deadline per attempt, bounded retries and a slow-transfer timeout.

Cloud-init accepts Lima’s generated SSH key. Lima plain mode supplies a loopback SSH connection and disables host directory mounts and automatic application port forwarding. The bootstrap restricts SSH to the Lima user with public-key authentication, installs `docker` and `docker-compose` from the guest’s configured repositories, then starts the daemon. `verify` checks the distribution, guest kernel architecture, effective SSH settings, Docker daemon platform and Compose plugin. After a successful check it prints the snapshot and versions and saves them with the check time in `build/vm/last-verification.txt`. [Lima plain mode](https://lima-vm.io/docs/config/plain/) · [Lima SSH and state](https://lima-vm.io/docs/faq/) · [Compose plugin](https://docs.docker.com/compose/install/linux/)

## Lifecycle

| Command from the checkout root | Result |
| --- | --- |
| `python3 -B tools/vm/tumbleweed.py status` | Shows whether this checkout’s instance is absent, stopped or running. |
| `python3 -B tools/vm/tumbleweed.py shell` | Opens the guest as the Lima user. Use `sudo -n docker …` there. |
| `python3 -B tools/vm/tumbleweed.py stop` | Shuts down the guest and preserves its disk. |
| `python3 -B tools/vm/tumbleweed.py up` | Resumes a stopped guest or creates it, retries package setup, and checks guest health. |
| `python3 -B tools/vm/tumbleweed.py destroy` | Shuts down and deletes this checkout’s `tw` instance, including its writable disk and Docker volumes. |

The launcher puts its Lima home under `build/vm/lima/`, downloaded base disks under `build/vm/images/` and temporary work under `build/vm/tmp/`. Lima stores the writable guest in its `tw/` subdirectory and the checkout’s private SSH key in `_config/`. The launcher generates a new instance identifier when it creates the VM. Before using an existing guest it matches `build/vm/instance-id` to Lima’s saved configuration. If a different guest already uses `tw` or an incomplete configuration prevents identification, it reports the path and preserves the disk. `destroy` removes the owned guest and its identifier. The per-checkout SSH identity, base-image cache, historical verification record and other named instances survive. [Lima environment variables](https://lima-vm.io/docs/config/environment-variables/)

Boot and package installation can take much longer under CPU emulation. If startup fails, inspect this guest's `serial*.log` and `ha.stderr.log` under `build/vm/lima/tw/`, then rerun `up`. When a package repository is unavailable, a retry uses the same disk. After `verify` passes, work inside the guest using synthetic data. Application startup, migrations and the production-host smoke test have their own gates in the [verification plan](../../docs/VERIFICATION_PLAN.md).

## Launcher tests

```sh
python3 -B -m unittest discover -s tools/vm -p 'test_*.py' -v
sh -n tools/vm/guest.sh
```

These tests use simulated Lima and download responses and real temporary directories inside `build/`. A live guest check requires `up` and `verify` on a Mac with the host tools listed above.
