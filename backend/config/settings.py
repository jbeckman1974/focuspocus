import os
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured

from .oidc import load_provider


def secret(name):
    path = os.environ.get(f"{name}_FILE")
    if path and os.environ.get(name):
        raise ImproperlyConfigured(f"Configure only one source for {name}")
    value = Path(path).read_text(encoding="utf-8").rstrip("\r\n") if path else os.environ.get(name)
    if not value:
        raise ImproperlyConfigured(f"Configure {name} using a secret file")
    return value


APP_ENV = os.getenv("APP_ENV", "production")
if APP_ENV not in {"test", "development", "production"}:
    raise ImproperlyConfigured("Invalid APP_ENV")
SECRET_KEY = secret("DJANGO_SECRET_KEY")
if len(SECRET_KEY) < 50:
    raise ImproperlyConfigured("Use at least 50 characters for DJANGO_SECRET_KEY")
DEBUG = False
ALLOWED_HOSTS = [host.strip() for host in os.getenv("ALLOWED_HOSTS", "localhost,127.0.0.1").split(",") if host.strip()]
ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
INSTALLED_APPS = [
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "core.apps.CoreConfig",
]
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "config.middleware.PrivateApiMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "core.oidc.backend.ProviderSessionMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]
DATABASES = {"default": {
    "ENGINE": "django.db.backends.postgresql",
    "NAME": os.getenv("DB_NAME", "focuspocus"),
    "USER": os.environ["DB_USER"],
    "PASSWORD": secret("DB_PASSWORD"),
    "HOST": os.getenv("DB_HOST", "db"),
    "PORT": os.getenv("DB_PORT", "5432"),
    "CONN_MAX_AGE": 0,
}}
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 12}},
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]
OIDC_PROVIDER = load_provider(os.getenv("FOCUSPOCUS_OIDC_FILE"))
AUTHENTICATION_BACKENDS = (
    ["core.oidc.backend.ProviderBackend"] if OIDC_PROVIDER else ["django.contrib.auth.backends.ModelBackend"]
)
SESSION_COOKIE_SECURE = CSRF_COOKIE_SECURE = APP_ENV == "production"
SESSION_COOKIE_HTTPONLY = CSRF_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = CSRF_COOKIE_SAMESITE = "Lax"
# Enable only when the trusted proxy overwrites this header and isolates the web port.
if os.getenv("TRUST_HTTPS_PROXY") == "1":
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
CSRF_FAILURE_VIEW = "core.auth_views.csrf_failure"
DATA_UPLOAD_MAX_MEMORY_SIZE = 1024 * 1024
SESSION_COOKIE_AGE = 60 * 60 * 24 * 14
USE_TZ = True
TIME_ZONE = "UTC"
SPA_ROOT = Path(os.getenv("SPA_ROOT", "/srv/frontend"))

# Logical linked bytes and the independent budget for unlinked bytes retained for undo.
ATTACHMENT_MAX_BYTES = int(os.getenv("ATTACHMENT_MAX_BYTES", 25 * 1024 * 1024))
WORKSPACE_ATTACHMENT_MAX_BYTES = int(os.getenv("WORKSPACE_ATTACHMENT_MAX_BYTES", 1024 * 1024 * 1024))
ATTACHMENT_HISTORY_MAX_BYTES = int(os.getenv("ATTACHMENT_HISTORY_MAX_BYTES", 256 * 1024 * 1024))
if ATTACHMENT_MAX_BYTES <= 0 or min(WORKSPACE_ATTACHMENT_MAX_BYTES, ATTACHMENT_HISTORY_MAX_BYTES) < 0:
    raise ImproperlyConfigured("Invalid attachment storage limits")
