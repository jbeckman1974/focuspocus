from django.urls import path

from . import views

urlpatterns = [
    path("bundle", views.download, {"mode": "bundle"}),
    path("personal", views.download, {"mode": "personal"}),
    path("outline.csv", views.download, {"mode": "csv"}),
    path("history", views.download, {"mode": "history"}),
    path("restore", views.import_bundle),
]
