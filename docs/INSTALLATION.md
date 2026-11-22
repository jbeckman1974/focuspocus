# Install FocusPocus on a trusted device

Open the built application at `/app/` over HTTPS or loopback. On a browser with installation support, use its **Install** or **Add to Home Screen** command. Signing into an installed copy uses the same account and workspace permissions as the website. On iPhone or iPad, use the browser’s Home Screen installation option for push reminders. [Web app manifests](https://web.dev/articles/add-manifest) · [WebKit Home Screen support](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)

On an Apple Silicon Mac, start the persistent application from the [local development workflow](OPERATIONS.md#daily-development-on-the-macbook). Use the built service on port 8000 to test installation and offline restart. The Vite development service on port 5173 supports live source editing. On a narrow screen, **Workspace** opens the workspace selector and tools. **Browse** opens navigation. **Inspector** opens the properties of the current selection.

## What is available offline

The first online visit downloads the public application shell. Installation stores the workspace page, its versioned JavaScript and CSS, the manifest and its icons. The build supplies integrity hashes for each file. The service worker fetches these files without credentials and checks the complete set before activating. An older open tab can finish using its own release. Close all open app tabs and reopen to use an available update. [Vite build configuration](https://vite.dev/config/build-options.html) · [Service-worker registration](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/register) · [Cache installation](https://developer.mozilla.org/en-US/docs/Web/API/Cache/addAll)

Private tasks and pending changes require the separate trusted-device setting. Reopening the installed app or `/app/` is the supported offline launch path. Account sessions, API responses, exports, attachment downloads and reminders never enter the public shell cache. Browser profiles with unavailable persistent storage can still use the online workspace.

## Reminder subscriptions after an upgrade

The updated application sends the same generic reminder without a task title on the lock screen. A previously enrolled browser keeps its old subscription when you check its status. Choosing **Replace browser subscription** asks for confirmation, revokes the existing endpoint and enrolls this browser with the new worker. The old worker continues to serve existing registrations. Use **Reminders** to disable the current account’s deliveries. [Integration setup](INTEGRATIONS.md)

## Check the installed build

Load `/app/`, wait for the worker to activate, disconnect and reopen the app. A profile without trusted-device enrollment should display the shell without private tasks. On an opted-in profile, compare queued changes after closing the browser, reopening and reconnecting. The automated journeys also run at 320 CSS pixels with touch input and inspect the exact cache keys after authentication. Physical-device installation and notification delivery require their own pilot results.
