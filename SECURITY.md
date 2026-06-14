# Security Policy

## Supported Version

Security fixes are applied to the current release.

## Reporting

Do not open a public Issue for a suspected secret leak or signature bypass. Report it privately through GitHub Security Advisories for this repository.

## Secrets

Never commit `.creamlon/`, complete `crv1_...` credentials, credential stores,
private Ed25519 keys, HMAC authorization key maps, or GitHub tokens.

Credential-backed task Issues contain only a public credential ID and
task-bound HMAC. If a complete credential secret appears in an Issue, comment,
log, or commit, revoke it before use and issue a replacement.
