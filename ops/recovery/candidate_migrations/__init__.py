"""Load the real migrations plus two extra steps from this read-only QA mount."""

from core import migrations

__path__ = [*__path__, *migrations.__path__]
