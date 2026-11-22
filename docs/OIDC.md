# Identity-provider sign-in

FocusPocus can delegate sign-in to an OpenID Connect provider such as Authentik. The operator provisions each local user and binds its exact provider subject. A verified login opens that user's existing private workspace and memberships. A deployment using this mode accepts sign-ins and recovery through the identity provider.

## Provider registration

Register a confidential authorization-code client with client-secret basic authentication, the `openid` scope, PKCE S256, and RS256-signed ID tokens. Register the exact HTTPS application URL ending in `/api/v1/oidc/callback`. Configure the provider authentication flow to require a second factor. For Authentik, configure its authentication flow and claim mappings so an MFA-completed login supplies one of the verified signals below. Test this with a pilot account on the deployed provider. [Authentik provider documentation](https://docs.goauthentik.io/add-secure-apps/providers/oauth2/) · [OpenID Connect Core](https://openid.net/specs/openid-connect-core-1_0.html)

Mount a read-only, restricted JSON configuration file available to the application user. Set `FOCUSPOCUS_OIDC_FILE` to its path inside the container. Omit the variable for local-account mode. The file has these properties.

| Property | Value |
| --- | --- |
| `issuer` | The exact HTTPS `iss` value from the provider, including a trailing slash if present. |
| `authorization_endpoint`, `token_endpoint`, `jwks_uri` | The provider's fixed HTTPS URLs. The server reads signing keys for each sign-in so key rotation takes effect immediately. Redirects from the token and key endpoints fail the sign-in. |
| `redirect_uri` | The externally registered HTTPS callback URL. |
| `client_id`, `client_secret` | The application's OIDC registration details. Keep this file and its backups under the operator's secret-handling controls. |
| `mfa_acr` | Optional exact `acr` value whose provider policy requires a second factor. If omitted, the signed `amr` array must contain `mfa`. |

Use the registered client ID as the token audience. Provide a stable nonreassignable subject and publish a public RSA signing key of at least 2048 bits under a unique key ID. Confirm the provider supplies the selected MFA claim only for a login that satisfied its second-factor policy. Tokens, authorization codes, CSRF values and client secrets should stay out of application and proxy logs. Configure the proxy to omit the query string on this callback.

## Bind and verify

Provision the local account through the existing operator command. Obtain its subject from the provider administrator's trusted record. In the web container, use the two operator-supplied values.

```sh
python manage.py bind_oidc_identity "$account_name" "$provider_subject"
```

Binding is idempotent for the same account and subject. A conflicting identity requires separate operator investigation. No passwords, access tokens or email addresses are needed for binding. Sign in through the identity provider and confirm the expected workspace, role and second-factor challenge. Verify that an unbound subject and a sign-in missing the required MFA signal both receive the generic failure screen. Exercise the regular login and recovery routes with the deployed mode enabled and confirm they direct the user back to the provider.

The original application backs sessions with PostgreSQL. When switching identity modes, retire old sessions during the maintenance window. An online session established under an earlier provider policy or a removed binding is cleared when it next accesses the application. A restore requires the normal session and database fence and an operator review of identity bindings before access opens.

The synthetic provider tests exercise real signed tokens, key rotation, PKCE and callback replay. The production pilot must record the issuer, client registration, date, proxy and second-factor outcome without recording credentials or token contents.
