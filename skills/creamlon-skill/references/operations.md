# Creamlon Operations

## Caller sequence

1. Run `discover` for the required capability and media types.
2. Run `inspect` on the selected repository.
3. Run `submit` with one input location.
4. Wait for the node to close the task Issue.
5. Run `fetch-proof --verify`.

Do not publish secrets or private input values in GitHub Issues.

## Optional node authorization

Free nodes need no key map. To require HMAC authorization, declare
`profiles.authorization.scheme: hmac-sha256` and generate a customer key:

```bash
npx --yes creamlon@0.1.0 hmac-key-new \
  --key-id customer-1 \
  --out .creamlon/authorization.keys.json
```

## Recovery and audit

- Resume interrupted delivery with `deliver --resume`.
- Run `status --repo-path .` after proof-log changes.
- Run `audit --repo-path .` to verify the local manifest and proof history.
- Record identity changes with `key-rotate` before discarding the old key.
