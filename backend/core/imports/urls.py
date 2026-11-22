from django.urls import path

from . import views

urlpatterns = [
    path("", views.collection),
    path("<uuid:batch_id>", views.detail),
    *[path(f"<uuid:batch_id>/{mode}", views.action, {"mode": mode}) for mode in ("commit", "rollback", "abort")],
]
