# Measure the representative workspace

Build the normal application and matching browser test image from a clean checkout, with Docker running on the native architecture. The browser accesses the compiled application through its Gunicorn process. The benchmark provisions PostgreSQL and migrates it, creates a private synthetic account, runs Chromium and removes the disposable stack. Build dependencies stay inside the images.

```sh
export EXPECTED_ARCH=arm64  # amd64 on a native x64 Linux runner
export FOCUSPOCUS_IMAGE=localhost/focuspocus:performance
export FOCUSPOCUS_TEST_BROWSER_IMAGE=localhost/focuspocus-browser:performance
revision=$(git rev-parse HEAD)
docker build --target application --label "org.opencontainers.image.revision=$revision" -t "$FOCUSPOCUS_IMAGE" .
docker build --target browser-tests --label "org.opencontainers.image.revision=$revision" -t "$FOCUSPOCUS_TEST_BROWSER_IMAGE" frontend
bash ops/performance/verify.sh
(cd build/performance && shasum -a 256 -c SHA256SUMS)
```

On the designated testing server, use its [bind-mount qualification procedure](../../docs/OPERATIONS.md) to allocate the run's disposable database inside the verified sibling container data folder. Only the loopback application port is published. The benchmark runs the browser on the Docker host even when invoked over SSH. A physical Mac-to-host LAN measurement requires the real client and has its own calibration record.

The PostgreSQL fixture contains 100 alternating sequential/parallel projects with ten groups of ten actions each. Multiples of 5, 7, 11, 13 and 17 have a tomorrow defer date, a flag, a held tag, a completion and a due date today, respectively. The same action can have several properties. Multiples of 23 have a rich-text note containing `bench`; even multiples of 23 also contain `ledger`. PostgreSQL must produce 434 and 217 note hits before the browser starts.

| Measurement | Observation |
| --- | --- |
| Fresh browser | From navigation and sign-in submit to the painted Inbox. The first Flagged, Completed and two independent text queries have their own timings. |
| Keyboard selection and inline typing | A trusted key event to two consecutive animation frames showing the new active, selected row or focused inline value. The tree stays open on the full Flagged projection. The title edit is canceled. |
| View switches | Alternate opening Flagged and Completed. The visible outline heading, total and first two matching actions must agree with the fixture. |
| Search switches | Alternate `bench` and `ledger` in Everything. The timing includes the normal search delay, count update and first two painted matching buttons. |
| Second session | A separate login observes the renamed action after the writer receives its HTTP response; a disconnected reader must observe a subsequent rename after its real online event. Record keyboard focus and selected identity independently. |
| Trusted idle tab | Record workspace reads on initial hydration, then profile and whole-workspace IndexedDB read counts and request latency over six idle seconds following two actual feed polls. The app must poll the device header without rereading the whole workspace during this interval. |

Each frequent interaction gets five warm-ups followed by fifty measured samples per direction. The nearest-rank p95 budgets are 100 ms for selection or typing and 500 ms for views or searches. Each convergence observation has a 5,000 ms limit. The observer uses browser event timestamps and animation frames; it continues checking the verified state through a paint opportunity. These are browser frame timings, with no physical display sensor. HTTP health round trips record the application transport as experienced by the browser.

`build/performance/report.json` includes the image identifiers, checkout revision, runner and browser resources, fixture counts, raw samples, warm-ups, budgets, focus outcomes, timings and completed phase. `SHA256SUMS` can be used to verify the report against the digest printed in the run log. Both stay under the ignored build folder locally; CI archives these two files and logs measured budgets. An interrupted run records the last phase when possible and fails the job. A subsequent run retains the previous report in a unique sibling directory. Checks that depend on a different physical device, a screen reader or actual deployment are recorded separately.
