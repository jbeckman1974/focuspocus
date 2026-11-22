# focuspocus

self hostable task manager

The first implementation milestone is a desktop-style task outline. Open the sample Inbox, capture a few tasks, and move them between projects. The inspector edits dates and tags, and the tag view shows the same tasks. Edits stay in the browser tab for the session. Use the sample reset to start again.

## Run the sample on an Apple Silicon Mac

Start a local ARM64 Docker engine and run these commands from the checkout root.

```sh
docker compose -f compose.dev.yaml up -d --build frontend
docker compose -f compose.dev.yaml exec frontend node -p 'process.platform + "/" + process.arch'
docker compose -f compose.dev.yaml exec frontend npm run check
```

Open [the sample workspace](http://127.0.0.1:5173/). The architecture check should print `linux/arm64`. In the outline, press `?` for keyboard commands. Use `docker compose -f compose.dev.yaml stop` when finished. [Sample walkthrough](docs/M1_WALKTHROUGH.md)

Start with the [project plan and milestone gates](docs/PROJECT_PLAN.md). It links to the maintained requirements, architecture, verification plan, operations guide, and decision log.

The production target is openSUSE Tumbleweed x64. Each release must publish both ARM64 and AMD64 application images under one version after native AMD64 application, startup and migration checks in GitHub Actions. The [Mac development workflow](docs/OPERATIONS.md#daily-development-on-the-macbook), [production host checks](docs/OPERATIONS.md#controlled-host-update) and [current progress](docs/PROGRESS.md) describe the evidence for each stage.
