# Restore a database after a failed upgrade

Keep the known-good application image digest, its Compose configuration, PostgreSQL major version, migration ledger and backup point together in the deployment record. After a database rewind, someone may have revoked a membership or a delivery may already have reached a provider. The restored site stays private while the operator reconciles those changes.

## Make a recoverable point

1. For a planned upgrade, put the site into maintenance, drain requests and workers, and confirm the last acknowledged write is present. Record its time and identity in the operator's protected log. For scheduled online backups PostgreSQL gives the dump a consistent snapshot. Record a committed checkpoint immediately before starting the dump as a conservative recovery point.
2. Prepare the operator's public RSA encryption certificate and validate its fingerprint against the independent key-custody record. Keep the corresponding protected private key and its unlock mechanism recoverable in separate custody. Grant the backup process only the public certificate. The operator computer needs Python 3 and OpenSSL 3 with CMS support. On macOS set `FOCUSPOCUS_OPENSSL` to the OpenSSL 3 executable if needed. Application dependencies stay in the image.
3. In the deployed checkout, set `RECIPIENT_CERT` to the verified certificate. Set `BACKUP_DIR` to a new operator-owned 0700 directory on protected storage. Use the deployed Compose project/environment and its pinned PostgreSQL client. An operator with access to the database container can use the following command. Sites using a dedicated whole-database backup role should substitute that role and its protected authentication method.

```sh
umask 077
python3 -B ops/recovery/envelope.py seal "$RECIPIENT_CERT" "$BACKUP_DIR/database.cms" -- \
  docker compose exec -T db pg_dump -U postgres --format=custom focuspocus
```

The command prints the ciphertext SHA-256 only after both the dump and encryption succeed. Record this hash with the checkpoint, file size, release and PostgreSQL identity in a protected backup catalog. Anyone with the public certificate can create a *new* encrypted archive. The authenticated catalog establishes which archive the operator actually made. Transport the ciphertext to the approved off-host destination, read it back and verify its hash against that catalog. Record destination, transfer completion and successful retrieval. Keep a separately protected, version-matched copy of the Compose settings, role bootstrap, service secrets and any integration keys. Check the additional roles, grants and extensions if the site has modified the supplied deployment. [OpenSSL CMS](https://docs.openssl.org/3.0/man1/openssl-cms/) · [PostgreSQL dump](https://www.postgresql.org/docs/18/app-pgdump.html)

Repeat at least every 12 hours, alert on a missed copy and escalate before the validated point reaches 24 hours old. Keep 48 hours of copies, then 7 daily, 4 weekly and 6 monthly points. Preserve the pre-change point through acceptance. Exercise decryption with each rotation and retain old keys until the last archive requiring them expires. [Operations](OPERATIONS.md#backups-and-clean-stack-restoration)

## Restore on an isolated openSUSE host

Use this procedure quarterly, before an incompatible upgrade and when recovering from a failed migration. Record UTC service-loss time. Keep writes closed and external deliveries stopped. Save the failed volume and capture its migration ledger and error. If the failure occurred after an earlier migration committed, an old application may also refuse this schema. A forward fix requires a tested migration from the exact partial state. The following procedure returns to the matched pre-change release using a fresh PostgreSQL cluster.

1. Retrieve the encrypted file from the approved off-host destination and its hash from the independent catalog. Recover the recipient certificate and private key through the documented custody procedure. Select the matching application image by digest, PostgreSQL image and recovered per-service configuration. Confirm free disk and RAM for the retrieved archive, its private verification copy, clear dump, clean cluster and operating margin. Use an encrypted volume for temporary cleartext.
2. Verify the existing Docker data parent against sibling container mounts on the host. Set `VOLUME_PARENT` to that verified path. Set `FOCUSPOCUS_SECRET_DIR` to the recovered absolute secret directory and `FOCUSPOCUS_IMAGE` to the known-good digest. The following Bash commands create a fresh directory under its `focuspocus/` child. Use a separate Compose project for every run. The restore overlay gives PostgreSQL this bind directory and places HTTP on the internal database network. Keep the reverse proxy and provider networks outside the drill.

```bash
set -euo pipefail
umask 077
mkdir -p -- "$VOLUME_PARENT/focuspocus"
export FOCUSPOCUS_RECOVERY_DATA_DIR
FOCUSPOCUS_RECOVERY_DATA_DIR=$(mktemp -d "$VOLUME_PARENT/focuspocus/recovery-XXXXXXXX")
mkdir -m 700 "$FOCUSPOCUS_RECOVERY_DATA_DIR/pgdata"
work="$FOCUSPOCUS_RECOVERY_DATA_DIR/private"
mkdir -m 700 "$work"
project="focuspocus-recovery-$(python3 -c 'import uuid; print(uuid.uuid4().hex)')"
dc=(docker compose -p "$project" -f compose.yaml -f ops/recovery/compose.restore.yaml)
"${dc[@]}" config --quiet
python3 -B ops/recovery/envelope.py open "$RECIPIENT_CERT" "$RECOVERY_KEY" \
  "$RETRIEVED_ARCHIVE" "$TRUSTED_SHA256" "$work/verified.dump"
"${dc[@]}" up -d --wait db
"${dc[@]}" exec -T db pg_restore --list < "$work/verified.dump" > "$work/archive-contents"
"${dc[@]}" exec -T db pg_restore -U fpmigrate -d focuspocus --single-transaction \
  --exit-on-error --no-owner --no-acl < "$work/verified.dump"
"${dc[@]}" exec -T db sh /docker-entrypoint-initdb.d/10-roles.sh
"${dc[@]}" run --rm --no-deps migrate
"${dc[@]}" run --rm --no-deps migrate python manage.py migrate --check
"${dc[@]}" run --rm --no-deps web python manage.py fence_restored_database
"${dc[@]}" up -d --no-deps --wait web
```

The output file appears only after checksum and authenticated decryption succeed. Use the recovered secrets to bootstrap the clean cluster. Compare the restored application migration ledger to the recovery-point record. Only the paired known-good image should apply migrations or grants here. The fence rotates workspace generations, expires sessions and recovery tokens, and holds outstanding jobs and external delivery attempts. Preserve evidence and start again in a new directory after any failure. [PostgreSQL restore](https://www.postgresql.org/docs/18/app-pgrestore.html) · [Offline recovery behavior](OFFLINE_PROTOCOL.md)

3. Through the isolated application, check readiness, sign in with two designated synthetic accounts, verify each can see only its own workspace, then capture and reread a synthetic task. Compare counts by workspace, attachment checksums and lengths, memberships, operation history, recurrence, views and review dates against the independent recovery inventory. Check that a pre-restore session is refused and a previously queued offline draft needs review. Review each membership revoked after the cut against an independent grant log before reopening access. Keep uncertain grants suspended. Reconcile external acknowledgements and deliveries with the provider. Reissue only work confirmed safe to repeat. In the isolated project start the worker and check its heartbeat and a dedicated synthetic job after completing the reconciliation.
4. Record when validated service became available, its image digests and schema, restored database/attachment/transfer sizes, latest confirmed restored write, first missing write and outstanding reconciliations. Compare the service-loss-to-validated interval to **4 hours**, and the service-loss-to-last-confirmed-restored-write interval to **24 hours**. Decide whether to switch service to the recovered cluster, replay later acknowledged changes or continue the forward repair. Keep the failed cluster available for investigation. For a field drill, stop its unique project with `"${dc[@]}" down` and dispose of its verified project-owned staging files and test bind directory under the operator's data handling procedure.

## Automated evidence

The native Actions stack and the Tumbleweed test runner call the same disposable drill. Each run freezes its synthetic worker, seeds 10,000 actions and 4 MiB of incompressible SQL attachment content in addition to the existing browser fixtures, and records a committed marker. A second write after the encrypted dump remains on the source. The test transfers the ciphertext to a separate staging directory, removes the original archive and restores an isolated failed-upgrade fixture. The candidate commits its first Django migration, then changes schema/data and raises a real PostgreSQL exception in its second. The harness checks the migration ledger, the rollback of its row and column, HTTP 503 on both incompatible application versions and continued source readiness.

During recovery it separately decrypts and restores into an empty database on the isolated test cluster. It compares runtime privileges, accounts, membership identities, ordered content, attachment hashes and bytes, job and session state, and operation history. It fences the clean clone, verifies the previously leased job and its uncertain delivery are held, checks account isolation, exercises a real worker and follows a browser across loss of its session and deliberate resubmission of a held draft. The run prints image identity, actual database size, archive/attachment bytes and elapsed seconds after these checks. The RPO value conservatively starts immediately before the transaction containing the last included marker. The RTO clock starts before the failed migration attempt and stops after the restored browser check.

With a native Linux Docker engine and an already-built candidate, set `EXPECTED_ARCH` and `FOCUSPOCUS_IMAGE` and run the stack verifier.

```sh
bash ops/verify-stack.sh
```

On the Tumbleweed x64 server run `python3 -B ops/test-host.py "$(git rev-parse HEAD)"` from a clean checkout. It places database data under the verified sibling bind parent. The local crypto-only tests also exercise a modified ciphertext with a recomputed checksum, an interrupted dump, private staging and refusal to overwrite a previous artifact.

```sh
python3 -B -m unittest discover -s tools/release -p test_recovery.py -v
```

The native drill uses two PostgreSQL clusters and one Docker host. The failed and clean databases share the second cluster. The ciphertext staging area, generated test key and both clusters share the host's failure domain. Its measured results apply to that workload. The **field recovery gate** requires retrieval after simulated loss of the original host from an independently administered off-host copy, independently recovered keys/configuration, physical transfer and the representative pilot inventory. Record actual elapsed times and data discrepancies. A separate PostgreSQL major-version rehearsal and Joe's pilot sign-off have their own evidence. [Verification plan](VERIFICATION_PLAN.md) · [Host runbook](../ops/README.md)
