# focuspocus

self hostable task manager

This repository contains the plan for a self-hosted browser task manager. The first implementation milestone is an interactive outline using sample tasks. Application development has yet to begin.

Start with the [project plan and milestone gates](docs/PROJECT_PLAN.md). It links to the maintained requirements, architecture, verification plan, operations guide, and decision log.

Development and daily tests will run in native Linux ARM64 containers on an Apple Silicon MacBook. Each release will publish both ARM64 and AMD64 images under one version after native AMD64 validation in GitHub Actions. See the [Mac development workflow](docs/OPERATIONS.md#daily-development-on-the-macbook) and [production host checks](docs/OPERATIONS.md#controlled-host-update).
