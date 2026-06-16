---
title: Documentation versioning
audience: users and maintainers
status: current
verified: 0.6.0
---

# Documentation versioning

Creamlon documentation follows the npm package version. It does not have a
separate version number.

The npm package version is not the same as the wire protocol version. Public
version 1 manifests, tasks, proofs, canonical signing payloads, and trust logs
have a narrower compatibility boundary described in
[Protocol compatibility](./protocol-compatibility.md).

## Sources by lifecycle

| Source | Meaning |
| --- | --- |
| `main` branch | Documentation for development at the next release boundary |
| Latest Git tag | Immutable documentation for that released package |
| npm package and release archive | Documentation shipped with a specific release |
| `CHANGELOG.md` | User-visible changes and migration context |

For stable behavior, read documentation from the Git tag matching the installed
CLI. Documentation on `main` can describe changes that are not yet published.

## Page metadata

Every page under `docs/` declares:

- `title`: human-readable page title
- `audience`: primary reader
- `status`: `current`, `experimental`, or `deprecated`
- `verified`: most recent package version used to validate the page

`verified` is evidence of review, not an independent documentation version. A
page with an older value needs review before the next release.

## Release policy

During the `0.x` series:

- Minor releases can contain user-visible breaking changes.
- Patch releases should remain compatible unless a security fix requires
  otherwise.
- Version 1 wire behavior should remain compatible unless a security fix
  requires a new scheme or protocol version.
- Breaking changes require changelog and migration notes.
- Experimental pages must state instability and enabling conditions.
- Deprecated behavior remains documented until its replacement and removal
  release are clear.

Release preparation must review the quickstart, caller guide, node operator
guide, security page, CLI references, and every page affected by user-visible
behavior. Update `verified` only after checking the examples and claims against
the release candidate.

## Historical versions

Do not copy every release into parallel directories during rapid development.
Git tags are the historical archive. Introduce a multi-version documentation
site only when more than one release line is actively supported.
