# {{name}}

Creamlon node published through this repository with bundled Creamlon files.

## Setup

```bash
npx --yes creamlon@0.8.2 keygen --out .creamlon/runtime
```

1. Put `.creamlon/runtime/public.b64url` in `.creamlon/manifest.yaml` at `identity.public_key`.
2. Keep the repository public with GitHub Issues enabled.
3. Add the GitHub Topic `creamlon-node`.
4. Commit `.creamlon/manifest.yaml` and `.creamlon/trust/`.
5. Keep private operator state in `.creamlon/runtime/`, which is git-ignored.

Do not ignore the whole `.creamlon/` directory in this layout. The manifest
and trust records are public protocol files; `.creamlon/runtime/` is private
operator state.

## External agents

Agents do not need the Creamlon CLI to inspect this node. They can read
`.creamlon/README.md` for orientation and `.creamlon/manifest.yaml` for the
machine-readable capability list, access requirements, and GitHub Issue
transport details.

## Tasks

```bash
npx --yes creamlon@0.8.2 watch owner/repo --repo-path . --once --pretty
npx --yes creamlon@0.8.2 deliver owner/repo <issue-number> \
  --repo-path . \
  --output-file ./result.txt \
  --pretty
npx --yes creamlon@0.8.2 status --repo-path .
```

Commit `.creamlon/trust/proofs.log` and `.creamlon/trust/status.json` after
delivery. Use `npx --yes creamlon@0.8.2 deliver --resume` after an interrupted
delivery.

This template accepts free tasks. Add the optional authorization profile from
the Creamlon protocol for caller allowlists. To sell one-time task access, add
the credential profile and capability access block documented in the protocol,
then issue credentials with:

```bash
npx --yes creamlon@0.8.2 credential create \
  --repo-path . \
  --capability-id <capability-id>
```

Keep `.creamlon/runtime/credentials.json` private. Commit
`.creamlon/trust/redemptions.log` alongside `.creamlon/trust/proofs.log` after
credential-backed delivery.
