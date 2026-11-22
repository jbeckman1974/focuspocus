import base64
from datetime import timedelta
from hashlib import sha256
import json
import secrets

from django.db import transaction
from django.utils import timezone
from django.utils.crypto import salted_hmac

from .models import LoginChallenge


def digest(purpose, value):
    return salted_hmac("focuspocus.oidc." + purpose, value, algorithm="sha256").hexdigest()


def policy_id(provider):
    return digest("policy", json.dumps(vars(provider), sort_keys=True))


def start(session, provider):
    browser = session.setdefault("oidc_browser", secrets.token_urlsafe(32))
    state = secrets.token_urlsafe(32)
    nonce = secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(48)
    now = timezone.now()
    LoginChallenge.objects.filter(expires_at__lte=now).delete()
    LoginChallenge.objects.create(
        state_digest=digest("state", state), browser_digest=digest("browser", browser),
        policy_digest=policy_id(provider), nonce=nonce, verifier=verifier,
        expires_at=now + timedelta(minutes=5),
    )
    proof = base64.urlsafe_b64encode(sha256(verifier.encode("ascii")).digest()).rstrip(b"=").decode("ascii")
    return state, nonce, proof


@transaction.atomic
def consume(session, provider, state):
    browser = session.get("oidc_browser")
    if not browser or len(state) != 43 or not state.isascii():
        return None
    record = LoginChallenge.objects.select_for_update().filter(
        pk=digest("state", state), browser_digest=digest("browser", browser),
        policy_digest=policy_id(provider), expires_at__gt=timezone.now(),
    ).first()
    if record is None:
        return None
    record.delete()
    return record.nonce, record.verifier
