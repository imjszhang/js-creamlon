# Extension: delivery-hpke-v2

Scheme: `hpke-x25519-hkdf-sha256-aes256gcm-v2`

Private bidirectional artifact delivery using RFC 9180 base mode:

- KEM: DHKEM(X25519, HKDF-SHA256), identifier `0x0020`
- KDF: HKDF-SHA256, identifier `0x0001`
- AEAD: AES-256-GCM, identifier `0x0002`
- `info`, PSK, PSK ID, and AAD are empty
- Each envelope contains one message at sequence number zero

The JSON envelope stores X25519 public keys as base64url SPKI DER. Implementers
must use the raw 32-byte X25519 public keys inside the RFC 9180 KEM context.

## Node manifest

```yaml
extensions:
  delivery:
    scheme: hpke-x25519-hkdf-sha256-aes256gcm-v2
    receive_public_key: "<base64url-x25519-spki-der>"
    transports:
      - presigned-object-storage
      - github-private-repo
    presigned_hosts:
      - storage.example.com
```

`presigned_hosts` is required when using `presigned-object-storage`. The node
only uploads task output to credential-free HTTPS URLs whose exact hostname is
listed. Redirects, localhost, and literal private addresses are rejected.

## Task extension

Task fields and workflows are identical to
[delivery-hpke-v1](./delivery-hpke-v1.md), except the `scheme` value is the v2
scheme above. New `extension delivery prepare` operations use the scheme
advertised by the node.

## Cross-account operation

For `github-private-repo`, the caller owns the private inbox repository and
must grant the node operator access before submitting a task. A same-account
test does not exercise this requirement because one token can already access
both repositories.

| Command | Actor token | Required GitHub access |
| --- | --- | --- |
| `extension delivery send-input` | Caller | Write the caller's private inbox |
| `submit` | Caller | Open Issues in the node repository |
| `extension delivery fetch-input` | Node | Read the caller's private inbox |
| `deliver` | Node | Comment on and close Issues in the node repository |
| `extension delivery send-output` | Node | Write the caller's private inbox |
| `extension delivery fetch-output` | Caller | Read the caller's private inbox |

Grant the node identity repository contents read/write access through an
appropriate collaborator role, fine-grained personal access token, or GitHub
App installation. Scope access to the inbox repository and required branch.
GitHub can return `404` instead of `403` when a token cannot see a private
repository.

The public task Issue still exposes the inbox repository slug, branch, artifact
paths, request ID, caller ephemeral public key, and input digest. Artifact
plaintext and ciphertext remain outside the Issue, but observers can correlate
these public identifiers. Use opaque paths where practical.

Prefer `presigned-object-storage` when caller and node are owned by different
accounts or organizations and standing cross-repository access is undesirable.
Its GET URLs remain outside the public Issue and should be delivered through a
private channel.

## Ciphertext envelope

```json
{
  "version": 1,
  "scheme": "hpke-x25519-hkdf-sha256-aes256gcm-v2",
  "ephemeral_public_key": "...",
  "iv": "...",
  "ciphertext": "..."
}
```

`iv` is the RFC 9180 base nonce for sequence number zero. `ciphertext` contains
the AES-GCM ciphertext followed by the 16-byte authentication tag.
