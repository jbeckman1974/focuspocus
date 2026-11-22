"""RFC 8292 VAPID authentication for generic, empty-payload Web Push messages."""

import base64
import hashlib
import time
from urllib.parse import urlsplit

import jwt
from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

from core.commands.validation import CommandError, fields

from . import transport
from .configuration import AdapterError, configuration, https_target
from .models import PushDevice, ReminderDelivery


def credentials():
    config = configuration().get("webPush")
    if config is None:
        return None
    try:
        subject = config["subject"]
        if not isinstance(subject, str) or not subject.startswith(("mailto:", "https://")):
            raise ValueError
        key = serialization.load_pem_private_key(config["privateKey"].encode(), password=None)
        if not isinstance(key, ec.EllipticCurvePrivateKey) or not isinstance(key.curve, ec.SECP256R1):
            raise ValueError
        cipher = Fernet(config["endpointKey"].encode())
        encoded = key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
        public = base64.urlsafe_b64encode(encoded).rstrip(b"=").decode("ascii")
        return key, public, subject, cipher
    except (KeyError, ValueError, TypeError, AttributeError) as exc:
        raise AdapterError("push_configuration") from exc


def public_key():
    try:
        values = credentials()
    except AdapterError:
        return None
    return values[1] if values else None


def allowed_endpoint(value):
    if not https_target(value):
        return False
    parts = urlsplit(value)
    if len(parts.path) < 2:
        return False
    host = parts.hostname
    return host in {"fcm.googleapis.com", "web.push.apple.com", "push.services.mozilla.com"} or (
        host.endswith(".push.services.mozilla.com") or host.endswith(".push.apple.com"))


def device_settings(user, device, body):
    current = PushDevice.objects.filter(user=user, device=device)
    if body is not None:
        fields(body, ["endpoint"])
        endpoint = body["endpoint"]
        if endpoint is None:
            withdraw(current)
        else:
            if not allowed_endpoint(endpoint):
                raise CommandError("Choose a supported browser push subscription.")
            cred = credentials()
            if not cred:
                raise CommandError("Browser push is unavailable.", 503)
            digest = hashlib.sha256(endpoint.encode()).hexdigest()
            occupied = PushDevice.objects.filter(endpoint_digest=digest).exclude(user=user, device=device).exists()
            if occupied:
                raise CommandError("Renew this browser subscription before enrolling it.", 409)
            withdraw(current.exclude(endpoint_digest=digest))
            current.update_or_create(user=user, device=device, defaults={
                "endpoint": cred[3].encrypt(endpoint.encode()).decode(), "endpoint_digest": digest, "enabled": True,
            })
    return {"enabled": current.filter(enabled=True).exists()}


def withdraw(devices):
    # Scrub the endpoint while keeping the delivery history, including unresolved acknowledgements.
    previous = list(devices.select_for_update().values_list("pk", flat=True))
    if previous:
        ReminderDelivery.objects.filter(device_id__in=previous, status="pending").update(status="cancelled")
        ReminderDelivery.objects.filter(device_id__in=previous, status="sending").update(status="uncertain")
        PushDevice.objects.filter(pk__in=previous).update(enabled=False, endpoint="", endpoint_digest=None)


def send(device):
    values = credentials()
    if not values:
        raise AdapterError("push_configuration")
    key, public, subject, cipher = values
    try:
        endpoint = cipher.decrypt(device.endpoint.encode()).decode()
    except (InvalidToken, UnicodeError) as exc:
        raise AdapterError("push_configuration") from exc
    if not allowed_endpoint(endpoint):
        raise AdapterError("push_configuration")
    target = urlsplit(endpoint)
    token = jwt.encode({"aud": f"https://{target.hostname}", "exp": int(time.time()) + 300,
                        "sub": subject}, key, algorithm="ES256")
    return transport.transaction("POST", endpoint, headers={
        "Authorization": f"vapid t={token}, k={public}", "TTL": "600", "Urgency": "normal",
    })[0]
