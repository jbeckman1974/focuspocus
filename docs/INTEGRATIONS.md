# Calendar, reminder and location setup

**Forecast** can show read-only events from a personal iCalendar feed. **Reminders** stores a member's reminders in the application. **Nearby** uses a foreground location request or a manually chosen place to find tasks associated with a located tag. The browser computes distance without sending the user's location to the server.

## Configure optional providers

Store a protected JSON configuration in the project's ignored `build/` directory or in the operator's existing secret store. Set `FOCUSPOCUS_INTEGRATIONS_CONFIG` to its file path and add `-f ops/compose.integrations.yaml` after the base Compose file. The overlay mounts the configuration read-only for web and worker and supplies worker outbound networking. It publishes no additional ports. Verify `docker compose -f compose.yaml -f ops/compose.integrations.yaml config --quiet` before applying the change.

| Property | Expected value |
| --- | --- |
| `calendars` | An object keyed by stable source IDs. Each entry contains the existing account's `username`, a display `label`, and the provider's HTTPS feed `url`. Treat a URL containing a feed token as a credential. |
| `webPush.subject` | Operator contact as a mailto or HTTPS URI. |
| `webPush.privateKey` | A protected P-256 VAPID private key in PEM format. |
| `webPush.endpointKey` | A Fernet key for encrypting stored device endpoints. Protect and back up the keys separately from the database. |

The account connects an approved source from **Calendars**. Forecast distinguishes provider events from editable tasks. A refresh failure retains the previous successful snapshot and reports the connection state. Events with the same provider identity update in place. After restoring a bundle, reconnect a calendar and verify its freshness before relying on it.

Set a personal reminder on a task. Browser notification delivery requires an enrolled browser and a supported push service. The application requests permission after the user chooses to enable notifications and uses a generic notification without task details. An interrupted delivery with an unknown provider outcome is held for reconciliation. Re-enable devices deliberately after a database restore.

For optional provider sign-in, mount the protected provider configuration on the web service using `FOCUSPOCUS_OIDC_CONFIG` and `-f ops/compose.oidc.yaml`. It requires an explicit local-account binding and verified MFA. [OIDC configuration and pilot checks](OIDC.md)
