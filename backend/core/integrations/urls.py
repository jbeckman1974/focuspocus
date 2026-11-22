from django.urls import path

from .calendars import calendars
from .places import locations
from .push import device_settings
from .reminders import reminder_list
from .views import endpoint


urlpatterns = [
    path("calendars", endpoint, {"handler": calendars}),
    path("reminders", endpoint, {"handler": reminder_list}),
    path("devices/<uuid:device>", endpoint, {"handler": device_settings}),
    path("places", endpoint, {"handler": locations}),
]
