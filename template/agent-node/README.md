# {{name}}

Creamlon node published through this repository.

## Setup

```bash
npx --yes creamlon@0.8.1 keygen --out .creamlon
```

1. Put `public.b64url` in `creamlon.yaml` at `identity.public_key`.
2. Keep the repository public with GitHub Issues enabled.
3. Add the GitHub Topic `creamlon-node`.
4. Keep `.creamlon/` private and local.

Keep the manifest status, capabilities, and media types accurate because
discovery reads them directly.

## Tasks

```bash
npx --yes creamlon@0.8.1 watch owner/repo --repo-path . --once --pretty
npx --yes creamlon@0.8.1 deliver owner/repo <issue-number> \
  --repo-path . \
  --output-file ./result.txt \
  --pretty
npx --yes creamlon@0.8.1 status --repo-path .
```

Commit `trust/proofs.log` and `trust/status.json` after delivery. Use
`npx --yes creamlon@0.8.1 deliver --resume` after an interrupted delivery.

This template accepts free tasks. Add the optional authorization profile from
the Creamlon protocol for caller allowlists. To sell one-time task access, add
the credential profile and capability access block documented in the protocol,
then issue credentials with:

```bash
npx --yes creamlon@0.8.1 credential create \
  --repo-path . \
  --capability-id <capability-id>
```

Keep `.creamlon/credentials.json` private. Commit `trust/redemptions.log`
alongside `trust/proofs.log` after credential-backed delivery.
