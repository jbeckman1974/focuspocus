from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import IntegrityError, transaction

from core.oidc.models import IdentityBinding
from core.oidc.provider import subject_valid


class Command(BaseCommand):
    help = "Bind an existing local account to the configured provider's exact subject."

    def add_arguments(self, parser):
        parser.add_argument("username")
        parser.add_argument("subject")

    def handle(self, *args, **options):
        provider = settings.OIDC_PROVIDER
        subject = options["subject"]
        if not provider or not subject_valid(subject):
            raise CommandError("A configured provider and a valid exact subject are required.")
        user = get_user_model().objects.filter(username=options["username"], is_active=True).first()
        if user is None:
            raise CommandError("The active local account could not be found.")
        try:
            with transaction.atomic():
                binding, _ = IdentityBinding.objects.get_or_create(
                    issuer=provider.issuer, subject=subject, defaults={"user": user},
                )
                if binding.user_id != user.pk:
                    raise CommandError("The subject is already bound to a different account.")
        except IntegrityError:
            raise CommandError("The local account already has a different identity binding.") from None
        self.stdout.write("Provider identity bound to the local account.")
