"""Disposable incompatible candidate for the failed migration rehearsal."""

import os

from config.settings import *  # noqa: F403

if os.environ.get("APP_ENV") != "development" or (os.environ.get("DB_HOST"), os.environ.get("DB_NAME")) != (
    "test-db", "failed_fixture",
):
    raise RuntimeError("The failing candidate requires its disposable clone.")

MIGRATION_MODULES = {"core": "candidate_migrations"}
