# Operate the M2 stack

## Local development on Apple Silicon

Start the native ARM64 Linux Docker engine. Run these commands from the project checkout.

```sh
python3 ops/init-secrets.py
docker compose -f compose.dev.yaml build web frontend
docker compose -f compose.dev.yaml up -d --wait web worker frontend
printf "Account name: "
IFS= read -r account_name
docker compose -f compose.dev.yaml exec web python manage.py provision_account "$account_name"
docker compose -f compose.dev.yaml run --rm test
```

The management command prompts for the password without echo. Open `http://localhost:8000/app/` for the built, same-origin application, or `http://localhost:5173/app/` to edit frontend source through Vite. Use `/sample/` for disposable fixture data. Stop the stack with `docker compose -f compose.dev.yaml stop`. The database volume persists. The test service uses a separate cluster and database role scope.

Secret creation is idempotent. Its files are readable by their mounted container UIDs; their enclosing `build/secrets/` directory is private to the local operator. Preserve this directory or supply equivalent managed files. Changing a database password file alone cannot rotate a PostgreSQL role’s password. Coordinate SQL rotation, mounted credentials and container replacement.

## Deploy a verified image

Use a confirmed version’s multi-platform GHCR index digest for `FOCUSPOCUS_IMAGE` and set `ALLOWED_HOSTS` to the actual hostname. The built-in port binds loopback. Set `TRUST_HTTPS_PROXY=1` only behind an isolated proxy that overwrites the HTTPS header. The stack expects a TLS proxy for browser access in production. Follow the MFA gate before internet exposure. Use `FOCUSPOCUS_SECRET_DIR` for the operator-managed secret directory.

After the planned backup and maintenance window, pull the approved digest, start PostgreSQL, apply migrations once, then start the web process and worker. Use the same environment for every Compose invocation.

```sh
docker compose -f compose.yaml pull
docker compose -f compose.yaml up -d --wait db
docker compose -f compose.yaml run --rm migrate
docker compose -f compose.yaml up -d --wait web worker
docker compose -f compose.yaml exec -T web python /srv/ops/check-runtime.py
docker compose -f compose.yaml exec -T worker python manage.py worker_health
```

On the actual x64 Tumbleweed host record the pulled index digest, local application image ID and platform, applied migrations, healthy services, proxy/TLS result, a synthetic account login, acknowledged task creation and reread after replacement. The release job has no production access. See the [operations guide](../docs/OPERATIONS.md#controlled-host-update) for the maintenance, recovery and verification sequence.

The SQL server initializes `fpapp` with DML on the reviewed application tables and `fpmigrate` with schema privileges. Runtime sessions cannot issue DDL, grant privileges, or edit the migration ledger. The migration wrapper serializes schema changes with a PostgreSQL advisory lock and grants access to new tables after successful migration. The cluster admin secret stays with the database container. Keep administrative commands and Docker socket access limited to trusted operators.

For an isolated database restored with `pg_restore --no-acl`, run the database bootstrap with `POSTGRES_DB` set to the restored database name before using its migration service. This reapplies the database and schema access restrictions, including revocation of public temporary-table and connection privileges. Run the migration wrapper against that database to grant runtime access to the reviewed tables. Keep the restored stack isolated until the [recovery procedure](../docs/OPERATIONS.md) completes.

### Verify on the target host

Export the approved `FOCUSPOCUS_IMAGE` index digest and the exact HTTPS `FOCUSPOCUS_ORIGIN` used by browsers. Run from the deployed checkout with its Compose environment. The baseline check matches the completed migration container and both running services to the selected AMD64 image configuration, verifies schema and worker health, and requests readiness through TLS.

```sh
bash tools/release/verify-host.sh
```

For authenticated acceptance, provision two dedicated ordinary accounts using `provision_account`. Choose different usernames starting with `focuspocus-smoke-` followed by 1–50 lowercase letters, digits or hyphens. Reserve each account's single private workspace for this check. Each run retains one synthetic Inbox task in the first account so future rollouts can reread earlier captures. The second account is used only for isolation checks. The verifier stops before capture if either workspace contains other tasks, projects or tags.

For each account, record these four JSON string fields in its own operator-owned regular file with mode `0600` or `0400` in the ignored `build/` directory on the target host. Use a private credential editor or a secret manager. Give the first file the name `target-probe-owner.json` and the second `target-probe-neighbor.json`.

| Field | Value |
| --- | --- |
| `origin` | The exact HTTPS origin, including a nondefault port when applicable, without a trailing slash. |
| `username` | The dedicated account's exact username. |
| `password` | Its provisioned password. |
| `workspace` | The canonical UUID of that account's private workspace. |

To look up each UUID on the host, set `account_name` to that synthetic username and run the following read.

```sh
docker compose -f compose.yaml exec -T web python -c \
  'import django,sys; django.setup(); from core.models import Workspace; print(Workspace.objects.get(private_owner__username=sys.argv[1]).pk)' \
  "$account_name"
```

Explicitly enable the one synthetic capture for full target verification.

```sh
FOCUSPOCUS_SYNTHETIC_CHECK=1 \
FOCUSPOCUS_SMOKE_FILE="$PWD/build/target-probe-owner.json" \
FOCUSPOCUS_ISOLATION_FILE="$PWD/build/target-probe-neighbor.json" \
  bash tools/release/verify-host.sh
```

The check signs in twice as the first synthetic account and once as the second, verifies each account can access only its own workspace, submits one capture, replays the same command in the other owner session and reads back its exact ID and order. It closes all three sessions and prints the outcome without credentials, cookies or task content. Record the full-check outcome, host, digests and backup ID in the deployment log.

## Automated release-candidate checks

Use a native Linux Docker engine and a prebuilt, locally loaded application image. Export `EXPECTED_ARCH` as `amd64` or `arm64` and `FOCUSPOCUS_IMAGE` as its local tag. Run the command from the candidate’s checkout.

```sh
bash ops/verify-stack.sh
```

The harness creates a uniquely named Compose project, fresh secrets and dedicated database volumes. It runs Django tests on the isolated test cluster, migrates twice, checks for uncommitted migrations, starts the exact candidate as web and worker, and drives authenticated browser sessions with generated credentials. It checks real worker delivery, seeds ordered captures, recreates the web and worker containers, and compares the identities, fields, order and tags of the saved tasks. After replacement it signs back in, verifies retained order and private isolation, issues a fresh capture, retries from an independent owner session and verifies delivery by the new worker. It restores a custom-format dump into an isolated database and verifies the post-write content and runtime grants before and after fencing the restored generation. The harness removes only its generated test resources at exit. Production recovery and off-host backup rehearsals have separate evidence requirements. [Verification plan](../docs/VERIFICATION_PLAN.md)

## Weekly dependency review

After the configuration reaches the default branch, Dependabot checks the frontend npm manifest and lock, hashed Python requirements, GitHub Action references, Dockerfile base images and Compose image references weekly. Related React packages and the two Psycopg distributions have update groups. Routine proposals keep Django on the approved 5.2 LTS line and keep Node, its type definitions and PostgreSQL on their current major versions. Revisit those boundaries before end of support or when an advisory requires an upgrade. Inspect Dependabot's recent update jobs on GitHub for skipped dependencies or registry failures. Each proposal goes through ordinary PR review and native CI. [Configuration](../.github/dependabot.yml) · [GitHub supported ecosystems](https://docs.github.com/en/code-security/reference/supply-chain-security/supported-ecosystems-and-repositories) · [Dependabot options](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference)

During the same review, compare both CPython archive URLs and their independent SHA-256 values in the root Dockerfile with the publisher's release assets. For a Node bump, align both Dockerfiles, the frontend's Node and npm checks, its package manifest and the lock-refresh workflow's image and version checks. Confirm the PostgreSQL image index matches in the deployment and test Compose files. Verify the Tumbleweed and PostgreSQL indexes include both target architectures. Check full Action commit SHAs against the intended upstream releases. These paired values include shell assertions, archive digests and workflow environment values that require maintainer review. [CPython archive releases](https://github.com/astral-sh/python-build-standalone/releases) · [Docker image inspection](https://docs.docker.com/reference/cli/docker/buildx/imagetools/inspect/)

For Python updates, check each exact version and the publisher hashes of wheels intended for the two Linux platforms. Retain the build's binary-only and required-hash flags. For npm updates, review the lock changes and install with `npm ci` in both native Linux builds. Exercise the candidate’s application, migrations and container startup before releasing it. [pip secure installs](https://pip.pypa.io/en/stable/topics/secure-installs/) · [npm ci](https://docs.npmjs.com/cli/v11/commands/npm-ci)
