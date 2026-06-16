# Extension governance

Creamlon extensions add optional behavior without changing version 1 core
objects or proof fields. This document defines how official and third-party
extensions avoid name collisions, ambiguous schemes, and verifier forks.

## Namespaces

Official extensions may use short namespaces reserved by this project, such as
`delivery` and `payment`.

Third-party extensions must use globally unique namespaces. Recommended forms:

- reverse DNS, for example `com.example.payment`
- GitHub repository path, for example `github.com/example/creamlon-payment`
- npm package name, for example `npm:@example/creamlon-payment`

Do not use short generic names for third-party extensions. Names such as
`storage`, `callback`, `payment`, or `identity` are likely to collide.

## Schemes

Every machine-interpreted extension task must define a stable `scheme` string.
The scheme must include a version and must be globally unique within its
namespace.

Published schemes are immutable. A semantic change requires a new scheme. This
includes changes to:

- required fields
- canonicalization
- cryptographic algorithms
- authorization or proof binding
- transport behavior
- public versus local-only data handling

## Manifest advertisement

Nodes advertise supported extension behavior in `creamlon.yaml`. Callers must
not emit extension task fields unless the node manifest advertises the required
namespace and scheme.

An extension may also require advertised transports, providers, feature flags,
or version ranges. Those requirements must be documented in the extension spec.

## Public and local-only data

Extension specs must identify which fields are safe for public Issues and which
must stay local or travel over private channels.

The following values must not appear in public Issues, comments, commits, or
logs:

- private keys
- complete `crv1_...` credentials
- HMAC secrets
- GitHub or provider tokens
- object storage credentials
- private artifact GET URLs
- OAuth refresh tokens
- plaintext private artifacts

## Proof boundary

Version 1 proof fields are not extensible. An extension must not require extra
fields in version 1 proofs. If an extension needs proof binding, it must define
canonical intent data and bind it through a digest already defined by that
extension's published version 1 proof binding, or through a new proof scheme or
protocol version.

## Lifecycle

Extension specs should declare one lifecycle state:

- `experimental`: semantics may change and must be explicitly enabled.
- `stable`: published schemes are immutable and require compatibility tests.
- `deprecated`: supported for migration, with replacement and removal guidance.

Stable extensions should include positive and negative conformance fixtures for
manifest parsing, task validation, canonical intent bytes, and secret handling.

## Registration

Official extensions are listed in [README.md](./README.md). Third-party
extensions can be documented externally, but should publish:

- namespace
- owner
- scheme strings
- lifecycle state
- specification URL
- conformance fixtures
- security notes

Registration is discovery metadata, not endorsement.
