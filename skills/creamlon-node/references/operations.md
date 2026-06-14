# Node Operations

## Optional authorization

Free nodes need no key map. To require HMAC authorization, declare
`profiles.authorization.scheme: hmac-sha256` and generate a customer key:

```bash
npx --yes js-creamlon@0.1.0 hmac-key-new \
  --key-id customer-1 \
  --out .creamlon/authorization.keys.json
```

## Recovery and audit

- Resume interrupted delivery with `deliver --resume`.
- Run `status --repo-path .` after proof-log changes.
- Run `audit --repo-path .` to verify the local manifest and proof history.
- Record identity changes with `key-rotate` before discarding the old key.
