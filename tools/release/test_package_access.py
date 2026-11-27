import unittest
from pathlib import Path


def job_body(workflow, name):
    body = workflow.split("\n  " + name + ":\n", 1)[1]
    lines = []
    for line in body.splitlines():
        if line.startswith("  ") and not line.startswith("    "):
            break
        lines.append(line)
    return "\n".join(lines)


class RegistryWorkflowTests(unittest.TestCase):
    def test_main_publication_requires_a_version_file_change(self):
        release = Path(".github/workflows/release.yml").read_text()
        triggers = release.split("\npermissions:", 1)[0]
        self.assertIn('tags: ["v*"]', triggers)
        self.assertIn('paths: ["release/version"]', triggers)
        self.assertNotIn("release/package", triggers)
        self.assertIn("workflow_dispatch:", triggers)

    def test_only_writers_log_in_and_native_readers_pull_anonymously(self):
        workflow = Path(".github/workflows/release.yml").read_text()
        for job in ("package-access", "readback"):
            with self.subTest(job=job):
                body = job_body(workflow, job)
                for credential in ("check-session.sh", "REGISTRY_TOKEN", "secrets.", "packages:"):
                    self.assertNotIn(credential, body)
        self.assertIn("python3 tools/release/visibility.py", job_body(workflow, "package-access"))
        readback = job_body(workflow, "readback")
        self.assertIn('DOCKER_CONFIG=$(mktemp -d "$RUNNER_TEMP/', readback)
        self.assertIn('{"auths":{"ghcr.io":{}}}', readback)
        self.assertIn("tools/release/readback.py", readback)
        self.assertIn("needs: [publish, readback]", job_body(workflow, "promote"))
        for job in ("publish", "promote"):
            self.assertIn("bash tools/release/check-session.sh", job_body(workflow, job))
        session = Path("tools/release/check-session.sh").read_text()
        self.assertLess(session.index("visibility.py"), session.index("docker login"))
        self.assertIn("--password-stdin", session)

    def test_both_native_qualifications_and_public_digests_precede_the_version_index(self):
        release = Path(".github/workflows/release.yml").read_text()
        native = Path(".github/workflows/qualify-platform.yml").read_text()
        for job, prior, arch in (
            ("qualify", "package-access", "amd64"), ("qualify-arm64", "qualify", "arm64"),
        ):
            section = job_body(release, job)
            self.assertIn("needs: " + prior, section)
            self.assertIn("uses: ./.github/workflows/qualify-platform.yml", section)
            self.assertIn("platform: " + arch, section)
        self.assertIn("needs: [qualify, qualify-arm64]", job_body(release, "publish"))
        for check in ("bash ops/verify-stack.sh", "bash ops/verify-readiness.sh performance",
                      "bash ops/verify-readiness.sh accessibility", "bash ops/verify-readiness.sh pg-upgrade",
                      "bash tools/release/check-session.sh"):
            self.assertLess(native.index(check), native.index("docker push"))
        self.assertIn('if [[ "$PLATFORM" == amd64 ]]', native)
        self.assertLess(native.index('visibility.py "$digest" "$digest"'), native.index("name: candidate-${{ inputs.platform }}"))
