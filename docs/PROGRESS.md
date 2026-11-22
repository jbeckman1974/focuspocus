# Implementation progress

## November 21, 2026

| Step | Result and evidence | Next action |
| --- | --- | --- |
| M0 planning | Six maintained specifications define M0–M7, 20 feature families and 32 acceptance cases. The reference baseline is native OmniFocus 4.10.1 for Mac. | Append the independent milestone audit and PR outcome here. |
| Host and release policy | Apple Silicon ARM64 for daily work. Native Linux AMD64 CI is required. Both app variants share each release version. The target host OS is openSUSE Tumbleweed x64. | Exercise the ARM64 development image at M1 and Tumbleweed host compatibility as the stack arrives. |
| Local artifacts | The root ignore rule covers all of `build/`. SHA-256 checks verified copies of the two supplied project briefs in `build/OmniFocus/project/`. Git ignore checks cover those copies, an HTML reference, VM disk and SSH key. | Record actual external downloads in `build/OmniFocus/` and guest boot in `build/vm/` separately from tooling tests. |
| Environment | Local checkout started on `main` at `9cb7011`. The GitHub app created remote branch `milestone/m0-planning`. The session cannot write local Git metadata or fetch external files from the Mac shell. Host inspection found no Docker, Lima, QEMU or UTM. No Codex usage reset has been applied. | Use authorized GitHub operations for reviewable source checkpoints. Keep the local checkout state and remote status distinct when reporting progress. |

The [verification plan](VERIFICATION_PLAN.md) defines the evidence for each milestone. Reference observations, a personal walkthrough and a production deployment must identify who performed them and where.
