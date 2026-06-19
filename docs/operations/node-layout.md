---
title: Node layout
audience: node operators
status: current
verified: 0.8.0
---

# Node layout

Creamlon supports two public node layouts. The root layout remains the default
created by `creamlon init`. The bundled layout lets an existing repository keep
Creamlon protocol files under `.creamlon/`.

## Root layout

```text
creamlon.yaml
trust/
  proofs.log
  redemptions.log
  key-rotations.log
  status.json
.creamlon/
  private.key
  credentials.json
  authorization.keys.json
  deliveries/
  outbox/
  cache/
```

In the root layout, `creamlon.yaml` and `trust/*` are public committed files.
The `.creamlon/` directory is local private state and should be ignored.

## Bundled layout

```text
.creamlon/
  manifest.yaml
  trust/
    proofs.log
    redemptions.log
    key-rotations.log
    status.json
  private.key
  credentials.json
  authorization.keys.json
  deliveries/
  outbox/
  cache/
```

In the bundled layout, `.creamlon/manifest.yaml` and `.creamlon/trust/*` are
public committed files. Private keys, credential stores, authorization key
maps, delivery state, outboxes, and caches remain private and must be ignored
individually.

Use this layout when the repository already has its own root-level structure
and you want Creamlon protocol files grouped like `.github/`.

To add Creamlon to an existing repository, run from the repository root:

```bash
creamlon init . --layout bundled
```

The command keeps an existing `README.md`, merges missing Creamlon
private-state patterns into an existing `.gitignore`, and refuses to overwrite
existing Creamlon template targets such as `.creamlon/manifest.yaml` or
`SKILL.md`.

## Discovery order

Remote discovery and local reads prefer the bundled layout first:

1. `.creamlon/manifest.yaml`
2. `creamlon.yaml`

Public trust files follow the same rule:

1. `.creamlon/trust/<file>`
2. `trust/<file>`

This keeps existing nodes compatible while allowing new nodes to adopt the
bundled layout incrementally.

## Operator checklist

- Commit exactly one public manifest location.
- Commit the matching public trust directory after delivery.
- Do not ignore the whole `.creamlon/` directory when using the bundled layout.
- Ignore private files inside `.creamlon/` by exact path or private subdirectory.
- Use `creamlon init . --layout bundled` when adding Creamlon to an existing
  repository.
- Run `creamlon validate --repo-path .` and `creamlon audit --repo-path .`
  after changing layout files.
