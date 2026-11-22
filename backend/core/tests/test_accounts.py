import secrets
from datetime import timedelta
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import IntegrityError, connection, transaction
from django.test import Client, TestCase
from django.utils import timezone

from core.auth_services import allow_attempt, issue_recovery, provision_account, redeem
from core.models import Item, ItemTag, LoginWindow, Membership, PasswordRecovery, Tag, Workspace


def new_account():
    name, password = secrets.token_hex(8), secrets.token_urlsafe(28)
    return provision_account(name, password), password


def post(client, path, payload, token):
    return client.post("/api/v1/" + path, payload, content_type="application/json", HTTP_X_CSRFTOKEN=token)


class AccountTests(TestCase):
    def test_provision_is_atomic_and_scoped(self):
        a, password = new_account()
        b, _ = new_account()
        self.assertNotEqual(a.private_workspace.pk, b.private_workspace.pk)
        self.assertFalse(a.is_staff)
        self.assertFalse(a.is_superuser)
        with self.assertRaises(ValidationError):
            provision_account(a.username, password)
        self.assertEqual(get_user_model().objects.count(), 2)
        self.assertEqual(Workspace.objects.count(), 2)
        self.assertEqual(Membership.objects.filter(role="owner").count(), 2)

    def test_cookie_login_rotation_csrf_and_logout(self):
        a, password = new_account()
        b, _ = new_account()
        client = Client(enforce_csrf_checks=True)
        session = client.get("/api/v1/session").json()
        self.assertIsNone(session["user"])
        self.assertEqual(session["workspaces"], [])
        payload = {"username": a.username, "password": password}
        self.assertEqual(client.post("/api/v1/login", payload, content_type="application/json").status_code, 403)
        logged = post(client, "login", payload, session["csrfToken"])
        self.assertEqual(logged.status_code, 200)
        data = logged.json()
        self.assertEqual(data["workspaces"], [{"id": str(a.private_workspace.id), "role": "owner"}])
        self.assertNotContains(logged, str(b.private_workspace.id))
        self.assertIn("no-store", logged["Cache-Control"])
        self.assertEqual(post(client, "logout", {}, session["csrfToken"]).status_code, 403)
        self.assertTrue(client.cookies["sessionid"]["httponly"])
        self.assertEqual(post(client, "logout", {}, data["csrfToken"]).json()["workspaces"], [])
        self.assertIsNone(client.get("/api/v1/session").json()["user"])

    def test_generic_failure_and_input_shape(self):
        a, _ = new_account()
        client = Client()
        wrong = secrets.token_urlsafe(18)
        bad_existing = post(client, "login", {"username": a.username, "password": wrong}, "")
        bad_missing = post(client, "login", {"username": secrets.token_hex(10), "password": wrong}, "")
        self.assertEqual((bad_existing.status_code, bad_existing.json()), (401, bad_missing.json()))
        self.assertEqual(bad_missing.status_code, 401)
        self.assertEqual(post(client, "login", {"username": a.username, "password": []}, "").status_code, 400)
        self.assertEqual(client.get("/api/v1/logout").status_code, 405)

    def test_recovery_is_hashed_single_use_and_revokes_logged_in_sessions(self):
        a, _ = new_account()
        first, second = Client(), Client()
        first.force_login(a)
        second.force_login(a)
        old = issue_recovery(a.username)
        token = issue_recovery(a.username)
        new_password = secrets.token_urlsafe(30)
        self.assertNotEqual(PasswordRecovery.objects.get(user=a).digest, token)
        self.assertFalse(redeem(old, new_password))
        with self.assertRaises(ValidationError):
            redeem(token, "x")
        response = post(Client(), "recover", {"token": token, "password": new_password}, "")
        self.assertEqual(response.status_code, 200)
        self.assertFalse(redeem(token, secrets.token_urlsafe(32)))
        self.assertIsNone(first.get("/api/v1/session").json()["user"])
        self.assertIsNone(second.get("/api/v1/session").json()["user"])
        a.refresh_from_db()
        self.assertTrue(a.check_password(new_password))

    def test_expired_recovery_is_rejected(self):
        user, _ = new_account()
        token = issue_recovery(user.username)
        PasswordRecovery.objects.filter(user=user).update(expires_at=timezone.now() - timedelta(seconds=1))
        self.assertFalse(redeem(token, secrets.token_urlsafe(32)))

    def test_login_window_is_bounded_and_expires(self):
        value = secrets.token_hex(8)
        self.assertTrue(allow_attempt("test", value, 1))
        self.assertFalse(allow_attempt("test", value, 1))
        self.assertFalse(LoginWindow.objects.filter(key=value).exists())
        LoginWindow.objects.update(started_at=timezone.now() - timedelta(minutes=11))
        self.assertTrue(allow_attempt("test", value, 1))

    def test_database_rejects_cross_workspace_parents_and_tags(self):
        a = new_account()[0].private_workspace
        b = new_account()[0].private_workspace
        parent = Item.objects.create(workspace=b, kind="project", position=1, title="Control")
        with self.assertRaises(IntegrityError), transaction.atomic():
            Item.objects.create(workspace=a, parent=parent, kind="action", position=1, title="Survey")
            connection.check_constraints()
        task = Item.objects.create(workspace=a, kind="action", position=1, title="Survey")
        tag = Tag.objects.create(workspace=b, title="Office")
        for scope in (a, b):
            with self.subTest(scope=scope.pk), self.assertRaises(IntegrityError), transaction.atomic():
                ItemTag.objects.create(workspace=scope, item=task, tag=tag)
                connection.check_constraints()


class RecoveryDeliveryTests(TestCase):
    def test_token_delivered_to_new_private_file_and_stdout_stays_clean(self):
        user, _ = new_account()
        with TemporaryDirectory() as tmp:
            filename = Path(tmp) / "handoff"
            stdout = StringIO()
            call_command("issue_recovery", user.username, output_file=str(filename), stdout=stdout)
            token = filename.read_text().strip()
            self.assertEqual(filename.stat().st_mode & 0o777, 0o600)
            self.assertNotIn(token, stdout.getvalue())
            with self.assertRaises(CommandError):
                call_command("issue_recovery", user.username, output_file=str(filename))
            self.assertEqual(filename.read_text().strip(), token)
            self.assertTrue(redeem(token, secrets.token_urlsafe(30)))

    def test_failed_output_preserves_previous_token_and_removes_partial_file(self):
        user, _ = new_account()
        previous = issue_recovery(user.username)
        with TemporaryDirectory() as tmp, patch("core.management.commands.issue_recovery.os.fsync", side_effect=OSError):
            path = Path(tmp) / "handoff"
            with self.assertRaises(CommandError):
                call_command("issue_recovery", user.username, output_file=str(path))
            self.assertFalse(path.exists())
        self.assertTrue(redeem(previous, secrets.token_urlsafe(30)))
