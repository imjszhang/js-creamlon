# {{name}}

Creamlon node published through this repository.

## Setup

```bash
creamlon keygen --out .creamlon
```

1. Put `public.b64url` in `CREAMLON.md` at `identity.public_key`.
2. Keep the repository public with GitHub Issues enabled.
3. Add the GitHub Topic `creamlon-node`.
4. Keep `.creamlon/` private and local.

Keep the manifest status, capabilities, and media types accurate because
discovery reads them directly.

## Tasks

```bash
creamlon watch owner/repo --repo-path . --once --pretty
creamlon deliver owner/repo <issue-number> \
  --repo-path . \
  --output-file ./result.txt \
  --pretty
creamlon status --repo-path .
```

Commit `trust/proofs.log` and `trust/status.json` after delivery. Use
`creamlon deliver --resume` after an interrupted delivery.

This template accepts free tasks. Add the optional authorization profile from
the Creamlon protocol only when access control is required.
