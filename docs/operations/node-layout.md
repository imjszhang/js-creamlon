---
title: Node layout
audience: node operators
status: current
verified: 0.8.1
---

# Node layout

A Creamlon-powered repository — a **melon** — supports two public layouts.
Choose the one that fits how you want to organize the store.

## Root layout — dedicated melon

Use the root layout when the repository is primarily the agent service store.
This is the default created by `creamlon init`.

```bash
creamlon init ./my-melon --name my-melon
```

```text
my-melon/
  creamlon.yaml                    # public service catalog
  trust/
    proofs.log                     # public delivery proofs
    redemptions.log                # public credential redemptions
    key-rotations.log              # public identity rotations
    status.json                    # public health status
  .creamlon/                       # private (git-ignored)
    runtime/
      private.key
      credentials.json
      authorization.keys.json
      deliveries/
      outbox/
      cache/
```

In the root layout, `creamlon.yaml` and `trust/*` are public committed files.
The `.creamlon/` directory is local private state and should be ignored as a
whole.

## Bundled layout — melon inside an existing repository

Use the bundled layout when you are adding melon capabilities to an existing
code, content, or agent repository.

```bash
cd ./my-existing-repo
creamlon init . --name my-existing-repo --layout bundled
```

```text
my-existing-repo/
  README.md                        # your existing README (untouched)
  src/                             # your existing code
  .creamlon/
    manifest.yaml                  # public service catalog
    README.md                      # orientation for agents without the CLI
    trust/
      proofs.log
      redemptions.log
      key-rotations.log
      status.json
    runtime/                       # private operator state (git-ignored)
      private.key
      credentials.json
      authorization.keys.json
      deliveries/
      outbox/
      cache/
```

In the bundled layout, `.creamlon/README.md`, `.creamlon/manifest.yaml`, and
`.creamlon/trust/*` are public committed files. The README gives agents that do
not have the Creamlon CLI a human-readable pointer to the manifest and GitHub
Issue transport. Private keys, credential stores, authorization key maps,
delivery state, outboxes, and caches live under `.creamlon/runtime/` and remain
private — do not ignore the whole `.creamlon/` directory.

The `init` command keeps an existing root `README.md`, merges the
`.creamlon/runtime/` ignore rule into an existing `.gitignore`, and refuses to
overwrite existing Creamlon template targets such as `.creamlon/README.md`,
`.creamlon/manifest.yaml`, or `SKILL.md`.

## Discovery order

Remote discovery and local reads prefer the bundled layout first:

1. `.creamlon/manifest.yaml`
2. `creamlon.yaml`

Public trust files follow the same rule:

1. `.creamlon/trust/<file>`
2. `trust/<file>`

This keeps existing melons compatible while allowing new melons to adopt the
bundled layout incrementally.

## Operator checklist

- Commit exactly one public manifest location.
- Commit `.creamlon/README.md` when using the bundled layout so external agents
  can find the manifest without the CLI.
- Commit the matching public trust directory after delivery.
- Do not ignore the whole `.creamlon/` directory when using the bundled layout.
- Ignore `.creamlon/runtime/`; legacy `.creamlon/private.key`,
  `.creamlon/credentials.json`, and other old private paths are still readable
  for existing melons but should be moved into runtime.
- Use `creamlon init . --layout bundled` when adding Creamlon to an existing
  repository.
- Run `creamlon validate --repo-path .` and `creamlon audit --repo-path .`
  after changing layout files.
