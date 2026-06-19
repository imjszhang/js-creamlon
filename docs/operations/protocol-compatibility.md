---
title: Protocol compatibility
audience: maintainers and extension authors
status: current
verified: 0.8.1
---

# Protocol compatibility

Creamlon has two version surfaces:

- The npm package version describes CLI, library, documentation, and release
  lifecycle.
- The wire protocol version describes public manifests, tasks, proofs,
  canonical signing payloads, and trust files.

During the `0.x` package series, CLI behavior can still change between minor
releases. The version 1 wire contract is narrower and should remain stable so
old nodes, callers, and verifiers can keep interoperating.

## Version 1 stable boundary

The following version 1 structures are public compatibility boundaries:

- Manifest core fields and profile fields in `creamlon.yaml` or
  `.creamlon/manifest.yaml`
- GitHub Issue task core fields
- Ed25519 proof fields
- proof canonical JSON field order
- HMAC authorization canonical JSON field order
- credential intent canonical JSON field order
- delivery intent canonical JSON field order for published delivery schemes
- Public trust logs and status in `trust/` or `.creamlon/trust/`

Unknown version 1 core fields are rejected. Do not add fields to these
structures for ordinary feature work.

## Extension rule

New behavior should use `extensions`, new schemes, or a new protocol version.
Use the smallest compatible surface:

- Add a new extension namespace for independent behavior.
- Add a new scheme when an existing extension changes semantics.
- Add a new protocol version only when version 1 core objects cannot express
  the required interoperability contract.

Version 1 proof fields are not an extension surface. Extensions must not require
callers or verifiers to accept extra proof fields. If extension data must be
bound to a proof, use a digest already defined by that extension's published
version 1 proof binding. If no such digest exists, define a new proof scheme or
protocol version.

## Scheme immutability

A published scheme name is immutable. Implementations may fix bugs that preserve
the same accepted and generated wire data, but must not change field meanings,
canonical payloads, cryptographic algorithms, or required validation rules under
the same scheme name.

Breaking changes require a new scheme name, for example `example-v2` instead of
changing `example-v1`.

## Capability negotiation

Callers must not submit extension fields unless the target node manifest
advertises support for the required extension namespace, scheme, transport, and
feature set. If support is missing, the caller should either fall back to an
older compatible flow or fail locally before opening a task Issue.

Experimental extension behavior must require an explicit user or operator
choice. It should not become the default path for nodes that do not advertise
support.

## Trust file compatibility

Public trust files are part of the interoperability surface:

- Keep existing paths stable.
- Keep newline-delimited JSON records for append-only logs such as
  `proofs.log`, `redemptions.log`, and `key-rotations.log`.
- Continue ignoring empty lines and comment lines that start with `#` in
  append-only logs.
- Keep `status.json` as one JSON object.
- Do not replace a stable file with an index, archive, array, database dump, or
  compressed format.

Performance improvements may add sidecar files such as indexes or archives, but
old tools must still be able to read the stable log files.

## Release checklist

Before publishing a user-visible change, check whether it:

- adds or changes version 1 core fields
- adds or changes proof fields
- changes canonical JSON bytes
- changes the meaning of a published scheme
- emits extension task fields without manifest negotiation
- changes public trust file paths or line formats
- exposes a secret, private key, GET URL, token, or credential secret in a
  public Issue, log, or comment

If any answer is yes, treat the change as a compatibility risk and use a new
extension, new scheme, migration note, or protocol version.
