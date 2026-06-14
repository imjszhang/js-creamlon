# Creamlon Operations

## Caller sequence

1. Run `discover` for the required capability and media types.
2. Run `inspect` on the selected repository.
3. Run `submit` with one input location.
4. Wait for the node to close the task Issue.
5. Run `fetch-proof --verify`.

Do not publish secrets or private input values in GitHub Issues.

## One-time task credentials

When a capability requires credential access, the node operator creates:

```bash
npx --yes creamlon@0.2.0 credential create \
  --repo-path . \
  --capability-id <id>
```

The caller passes the privately received complete value to
`submit --credential`. The Issue contains only a task-bound HMAC. The node
stores secrets in `.creamlon/credentials.json` and records successful
redemption in `trust/redemptions.log`.

Use `credential list` to inspect status and `credential revoke <id>` to revoke
an unused credential. Neither command prints credential secrets.

## Optional node authorization

Free nodes need no key map. To require HMAC authorization, declare
`profiles.authorization.scheme: hmac-sha256` and generate a customer key:

```bash
npx --yes creamlon@0.2.0 hmac-key-new \
  --key-id customer-1 \
  --out .creamlon/authorization.keys.json
```

## Recovery and audit

- Resume interrupted delivery with `deliver --resume`.
- Run `status --repo-path .` after proof-log changes.
- Run `audit --repo-path .` to verify the local manifest, redemption log, and
  proof history.
- Record identity changes with `key-rotate` before discarding the old key.
