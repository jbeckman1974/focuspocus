# Browser and accessibility qualification

Run from the repository root on a native Linux Docker daemon. On an Apple Silicon Mac, select its ARM64 Linux Docker context and use `EXPECTED_ARCH=arm64`. The release workflow uses a native Linux AMD64 runner. Both images build their dependencies inside their target containers.

```sh
export EXPECTED_ARCH=amd64
export FOCUSPOCUS_IMAGE=focuspocus:readiness-local
export FOCUSPOCUS_ACCESSIBILITY_IMAGE=focuspocus:accessibility-local
docker build --target application --tag "$FOCUSPOCUS_IMAGE" .
docker build --target accessibility-tests --tag "$FOCUSPOCUS_ACCESSIBILITY_IMAGE" frontend
bash ops/accessibility/verify.sh
```

The harness creates a disposable PostgreSQL database, migrates it and starts the application. The web service binds to a random host loopback port. Each engine receives three separate synthetic accounts. The browser joins the web container's network namespace to reach the application on loopback. The test runner removes the disposable project and its account files at the end. On a shared testing server, use the [private-host procedure](../README.md#private-tumbleweed-x64-test-server) to allocate the host data folder.

The browser image uses the project's pinned Node base and Playwright package. Playwright installs the matching revisions of Chromium, Firefox and WebKit. Each engine runs the same six journeys. The Actions log includes engine and version, each journey's result, and the final exit status. An engine failure fails the job. Authenticated traces, video and screenshots are disabled.

| Journey | What the test checks |
| --- | --- |
| Keyboard capture and organization | Focus enters the composer. Range selection, indent, collapse, expand, open and dismiss commands, rename and undo use the keyboard. Tree level, position, selected state, accessible description, focus indicator and task identity agree. Another account opens Everything and cannot see the item. |
| Project review | A keyboard user creates a project and action, reviews the project in the all-projects queue and verifies the original action remains open. |
| Touch and reflow | Touch input selects a task at 320 CSS pixels. The inspector saves its new title, closing the inspector and navigation restores focus, and the document fits the viewport. The capture button meets the tested target-size minimum. |
| Appearance | A pointer user selects a public sample row, enlarges type and switches themes. The selected-row and capture-button text reach 4.5:1 contrast on both surfaces. The system's reduced-motion setting suppresses a requested transition. |
| Recovery from a lost reply | A second browser sees the committed capture. The first exposes an alert and retries the original command without duplicating the task. |
| Resolving a conflicting edit | Two browser profiles edit the same task. The losing editor gets an alert with the original draft and current title. Deliberate reapplication survives reload with the same item ID. |

Record real browser versions and assistive technology separately for the [device acceptance protocol](../../docs/VERIFICATION_PLAN.md#desktop-accessibility-and-performance). On Safari with VoiceOver and Firefox with NVDA, complete capture, organization, review, conflict resolution and undo. Listen for the row name, level, selection count, save and error messages. Check a row beyond the first window, browser zoom, focus visibility and modal focus return. Exercise a real touch device and the installed Home Screen app. Record the browser, OS, assistive technology, build, input method and any failed step before signing off the device.

The Linux WebKit record covers Playwright's WebKit build. Apple's Safari and VoiceOver, Windows NVDA, real mobile installation, device permissions and notification delivery require their own run. [Playwright browser builds](https://playwright.dev/docs/browsers) · [WAI-ARIA tree pattern](https://www.w3.org/WAI/ARIA/apg/patterns/treeview/) · [WCAG 2.2](https://www.w3.org/TR/WCAG22/)
