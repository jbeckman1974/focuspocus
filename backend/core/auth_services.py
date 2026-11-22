import hashlib
import secrets
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.db import transaction
from django.utils import timezone
from django.utils.crypto import salted_hmac

from .models import LoginWindow, Membership, PasswordRecovery, Workspace


@transaction.atomic
def provision_account(username, password):
    model = get_user_model()
    user = model(username=model.normalize_username(username))
    validate_password(password, user)
    user.set_password(password)
    user.full_clean()
    user.save(force_insert=True)
    workspace = Workspace.objects.create(private_owner=user)
    Membership.objects.create(user=user, workspace=workspace, role="owner")
    return user


def digest(token):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


@transaction.atomic
def issue_recovery(username):
    user = get_user_model().objects.select_for_update().get(username=username, is_active=True)
    token = secrets.token_urlsafe(32)
    PasswordRecovery.objects.update_or_create(
        user=user, defaults={"digest": digest(token), "expires_at": timezone.now() + timedelta(minutes=15)}
    )
    return token


@transaction.atomic
def redeem(token, password):
    fingerprint = digest(token)
    user_id = PasswordRecovery.objects.filter(digest=fingerprint).values_list("user_id", flat=True).first()
    if user_id is None:
        return False
    # Issuance and redemption take the user lock first to serialize replacement and replay.
    user = get_user_model().objects.select_for_update().filter(pk=user_id, is_active=True).first()
    if not user:
        return False
    record = PasswordRecovery.objects.filter(user=user, digest=fingerprint, expires_at__gt=timezone.now()).first()
    if not record:
        return False
    validate_password(password, user)
    user.set_password(password)
    user.save(update_fields=["password"])
    record.delete()
    return True


def allow_attempt(scope, value, limit):
    # Persist a digest so neither entered usernames nor client addresses appear in this table.
    key = salted_hmac("focuspocus.rate." + scope, value, algorithm="sha256").hexdigest()
    now = timezone.now()
    cutoff = now - timedelta(minutes=10)
    with transaction.atomic():
        LoginWindow.objects.filter(started_at__lt=cutoff - timedelta(days=1)).delete()
        window, _ = LoginWindow.objects.select_for_update().get_or_create(key=key, defaults={"started_at": now})
        if window.started_at <= cutoff:
            window.started_at = now
            window.attempts = 0
        if window.attempts >= limit:
            return False
        window.attempts += 1
        window.save(update_fields=["started_at", "attempts"])
    return True
