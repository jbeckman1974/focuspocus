from django.conf import settings
from django.db import models


class IdentityBinding(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    issuer = models.URLField(max_length=512)
    subject = models.CharField(max_length=255)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["issuer", "subject"], name="oidc_unique_identity")]


class LoginChallenge(models.Model):
    state_digest = models.CharField(primary_key=True, max_length=64)
    browser_digest = models.CharField(max_length=64)
    policy_digest = models.CharField(max_length=64)
    expires_at = models.DateTimeField(db_index=True)
    nonce = models.CharField(max_length=90)
    verifier = models.CharField(max_length=90)
