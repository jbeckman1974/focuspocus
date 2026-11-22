"""Same-origin JSON session used for the synthetic deployment check."""

import json
from contextlib import contextmanager
from http.cookiejar import CookieJar
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, HTTPCookieProcessor, Request, build_opener


class ProbeError(Exception):
    pass


class ApiFailure(ProbeError):
    def __init__(self, status):
        self.status = status
        super().__init__(f"API request failed with HTTP {status}.")


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class ApiSession:
    def __init__(self, origin):
        self.origin = origin
        self.opener = build_opener(NoRedirect(), HTTPCookieProcessor(CookieJar()))
        self.csrf = ""

    def request(self, path, data=None):
        headers = {"Accept": "application/json"}
        body = None
        if data is not None:
            headers.update({"Content-Type": "application/json", "Origin": self.origin, "X-CSRFToken": self.csrf})
            body = json.dumps(data).encode()
        request = Request(self.origin + "/api/v1/" + path, data=body, headers=headers)
        try:
            with self.opener.open(request, timeout=15) as response:
                if response.headers.get_content_type() != "application/json":
                    raise ProbeError("Expected a JSON API response.")
                raw = response.read(8 * 1024 * 1024 + 1)
                if len(raw) > 8 * 1024 * 1024:
                    raise ProbeError("The verification workspace exceeded the response size limit.")
                result = json.loads(raw)
        except HTTPError as error:
            error.close()
            raise ApiFailure(error.code) from None
        except (URLError, OSError, ValueError) as error:
            raise ProbeError("The API connection or JSON response was invalid.") from error
        if not isinstance(result, dict):
            raise ProbeError("Expected a JSON response object.")
        return result


@contextmanager
def signed_in(origin, account):
    session = ApiSession(origin)
    anonymous = session.request("session")
    if anonymous["user"] is not None:
        raise ProbeError("Expected an independent anonymous session.")
    session.csrf = anonymous["csrfToken"]
    identity = session.request("login", {"username": account["username"], "password": account["password"]})
    session.csrf = identity["csrfToken"]
    try:
        if identity["user"]["username"] != account["username"] or identity["workspaces"] != [
            {"id": account["workspace"], "role": "owner"}
        ]:
            raise ProbeError("The account does not exclusively own the expected workspace.")
        yield session
    finally:
        session.request("logout", {})
