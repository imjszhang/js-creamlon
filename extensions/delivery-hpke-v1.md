# Extension: delivery-hpke-v1

Scheme: `hpke-x25519-aes256gcm-v1`

Private bidirectional artifact delivery for agent tasks. Core Creamlon Issues
carry digests and signed proofs. This extension encrypts input and output
artifacts with X25519 key agreement and AES-256-GCM.

## Non-goals

- Does not change Ed25519 proof fields
- Does not embed artifact bytes in Issues
- Does not provide object-storage credentials (callers supply presigned URLs)

## Node manifest

```yaml
extensions:
  delivery:
    scheme: hpke-x25519-aes256gcm-v1
    receive_public_key: "<base64url-x25519-spki-der>"
    transports:
      - presigned-object-storage
      - github-private-repo
```

Generate a node delivery key pair:

```bash
creamlon extension delivery keygen --out .creamlon
```

Place `delivery.public.b64url` in `creamlon.yaml` as `receive_public_key`.
Keep `delivery.private.b64url` local.

## Task extensions

### presigned-object-storage

```yaml
extensions:
  delivery:
    scheme: hpke-x25519-aes256gcm-v1
    transport: presigned-object-storage
    ephemeral_public_key: "<caller task public key>"
    artifacts:
      input:
        upload_url: "https://...presigned-put..."
      output:
        upload_url: "https://...presigned-put..."
```

Issue exposes PUT URLs only. GET URLs and the caller ephemeral private key live
in `.creamlon/outbox/{request_id}.json`.

For presigned input fetch, the node operator passes `--input-get-url` to
`extension delivery fetch-input` through a private channel or storage policy that
grants read access outside the public Issue.

### github-private-repo

```yaml
extensions:
  delivery:
    scheme: hpke-x25519-aes256gcm-v1
    transport: github-private-repo
    ephemeral_public_key: "<caller task public key>"
    github:
      repo: github:alice/caller-deliveries
      ref: main
      input_path: inbox/{request_id}/input.enc
      output_path: inbox/{request_id}/output.enc
```

The caller repository is private. The node GitHub token needs read access to
input and write access to output paths.

## Local outbox

`.creamlon/outbox/{request_id}.json` (mode `0600`):

```json
{
  "version": "1",
  "request_id": "...",
  "scheme": "hpke-x25519-aes256gcm-v1",
  "transport": "presigned-object-storage",
  "ephemeral_private_key": "...",
  "ephemeral_public_key": "...",
  "artifacts": {
    "input": { "get_url": "https://..." },
    "output": { "get_url": "https://..." }
  }
}
```

Never commit outbox files or print private keys in logs.

## Workflows

### Caller agent

1. `extension delivery prepare` — generate task keys and extensions JSON
2. `extension delivery send-input` — encrypt input to node public key and upload
3. `submit --extensions-file ... --input-digest ...`
4. After Issue closes: `fetch-proof --verify`
5. `extension delivery fetch-output` — decrypt and verify `proof.output_digest`

### Node agent

1. `watch` — validate task
2. `extension delivery fetch-input` — decrypt and verify `task.input.digest`
3. Execute capability locally
4. `deliver --output-file ...` — sign plaintext digest
5. `extension delivery send-output` — encrypt output to caller task public key

## Verification

| Step | Check |
| --- | --- |
| Input | `sha256(decrypted input) == task.input.digest` |
| Output | `sha256(decrypted output) == proof.output_digest` |
| Core | `fetch-proof --verify` signature and task binding |

## Ciphertext format

JSON UTF-8 envelope:

```json
{
  "version": 1,
  "scheme": "hpke-x25519-aes256gcm-v1",
  "ephemeral_public_key": "...",
  "iv": "...",
  "ciphertext": "..."
}
```
