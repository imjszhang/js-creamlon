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
