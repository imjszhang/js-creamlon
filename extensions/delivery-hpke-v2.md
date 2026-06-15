# Extension: delivery-hpke-v2

Scheme: `hpke-x25519-hkdf-sha256-aes256gcm-v2`

Private bidirectional artifact delivery for agent tasks. Core Creamlon Issues
carry digests and signed proofs. This extension encrypts input and output
artifacts using RFC 9180 base mode:

- KEM: DHKEM(X25519, HKDF-SHA256), identifier `0x0020`
- KDF: HKDF-SHA256, identifier `0x0001`
- AEAD: AES-256-GCM, identifier `0x0002`
- `info`, PSK, PSK ID, and AAD are empty
- Each envelope contains one message at sequence number zero

The JSON envelope stores X25519 public keys as base64url SPKI DER. Implementers
must use the raw 32-byte X25519 public keys inside the RFC 9180 KEM context.

## Non-goals

- Does not embed artifact bytes in Issues
- Does not provide object-storage credentials (callers supply presigned URLs)

## Node manifest

```yaml
profiles:
  github:
    transport: issues
    operator: bob
extensions:
  delivery:
    scheme: hpke-x25519-hkdf-sha256-aes256gcm-v2
    receive_public_key: "<base64url-x25519-spki-der>"
    transports:
      - github-private-repo
      - presigned-object-storage
    github:
      inbox_path_template:
        input: tasks/{request_id}/input.enc
        output: tasks/{request_id}/output.enc
    presigned_hosts:
      - storage.example.com
```

Generate a node delivery key pair:

```bash
creamlon extension delivery keygen --out .creamlon
```

Place `delivery.public.b64url` in `creamlon.yaml` as `receive_public_key`.
Keep `delivery.private.b64url` local.

`presigned_hosts` is required when using `presigned-object-storage`. The node
only uploads task output to credential-free HTTPS URLs whose exact hostname is
listed. Redirects, localhost, and literal private addresses are rejected.

`profiles.github.operator` identifies the GitHub user the caller should invite
to a private inbox. It is optional for user-owned node repositories, where the
repository owner is the fallback. Organization-owned nodes must declare an
operator user because an organization cannot accept a collaborator invitation.

The optional inbox path templates are caller defaults. They are not an access
control boundary. Templates must be relative, contain `{request_id}`, and may
not contain traversal segments, backslashes, or control characters.

## Task extensions

### presigned-object-storage

```yaml
extensions:
  delivery:
    scheme: hpke-x25519-hkdf-sha256-aes256gcm-v2
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
    scheme: hpke-x25519-hkdf-sha256-aes256gcm-v2
    transport: github-private-repo
    ephemeral_public_key: "<caller task public key>"
    github:
      repo: github:alice/caller-deliveries
      ref: main
      input_path: inbox/{request_id}/input.enc
      input_commit: 0123456789abcdef0123456789abcdef01234567
      output_path: inbox/{request_id}/output.enc
```

The caller repository is private. The node GitHub token needs read access to
input and write access to output paths. `input_commit` is required and pins
input reads to the immutable commit created by `send-input`; nodes must not
read input from the moving branch head.

This is the default GitHub-profile transport. Use one private inbox repository
per node repository. Multiple capabilities and requests for that node share the
repository but use request-scoped paths and immutable input commits.

### Caller inbox registry

The caller stores local inbox mappings in
`.creamlon/caller/inboxes.yaml`:

```yaml
version: "1"
inboxes:
  - node: bob/echo-node
    operator: bob
    repo: github:alice/creamlon-inbox-bob-echo-node
    ref: main
    trust: trusted
    path_template:
      input: tasks/{request_id}/input.enc
      output: tasks/{request_id}/output.enc
    grant: invitation-pending-push
    granted_at: null
```

Initialize and authorize a node:

```bash
creamlon caller inbox init --node bob/echo-node
creamlon caller inbox grant --node bob/echo-node
creamlon caller inbox protect --node bob/echo-node
creamlon caller inbox check --node bob/echo-node
```

`init` creates a private repository named
`creamlon-inbox-{node-owner}-{node-repo}` under the caller account unless
`--github-repo` overrides it. `grant` sends a collaborator invitation using
the manifest operator or node owner. For a personal inbox repository, GitHub
supports the default `push` collaborator role; `maintain` and `admin` are
available only for organization-owned inbox repositories.

New invitations remain `invitation-pending-*` with `granted_at: null` until the
operator accepts them and `caller inbox check` observes effective write access.
If caller and operator are the same user, the repository owner already has
implicit admin access: `grant` is a no-op and that access cannot be revoked
without changing repository ownership or transport.

The caller token used by `grant` and `revoke` needs repository Administration
write permission. The token used by `check` needs repository Metadata read
permission.
The first CLI version automates GitHub collaborator grants; GitHub App and
fine-grained token policies remain administrator-managed alternatives.

`extension delivery prepare bob/echo-node` defaults to
`github-private-repo` and resolves repository, branch, and path templates from
this registry. Explicit CLI options override registry values.

Trust levels have local caller semantics:

| Trust | Behavior |
| --- | --- |
| `trusted` | Standing per-node inbox access is allowed |
| `trial` | GitHub delivery requires explicit `--allow-trial-inbox`; prefer presigned storage |
| `blocked` | `grant` and registry-backed `prepare` are rejected |

A single inbox with node-specific paths is an operational layout only. GitHub
repository permissions are repository-wide, so paths do not isolate mutually
untrusted operators. `caller inbox protect` blocks force-push and branch
deletion when the caller's GitHub plan supports protected private branches.
`check` reports transport readiness and branch hardening separately.

## Local outbox

`.creamlon/outbox/{request_id}.json` (mode `0600`):

```json
{
  "version": "1",
  "request_id": "...",
  "scheme": "hpke-x25519-hkdf-sha256-aes256gcm-v2",
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

1. `extension delivery prepare` — generate task keys, draft extensions, and outbox
2. `extension delivery draft` — create the single local task YAML
3. `extension delivery send-input --task-file ... --extensions-file ... --outbox ...`
   — upload input and write the immutable `input_commit` into all local state
4. `submit --task-file ...` — submit that same updated task
5. After Issue closes: `fetch-proof --verify`
6. `extension delivery fetch-output` — decrypt and verify `proof.output_digest`

### Node agent

1. `watch` — validate task
2. `extension delivery fetch-input` — decrypt and verify `task.input.digest`
3. Execute capability locally
4. `extension delivery send-output` — encrypt output and record its digest receipt
5. `deliver --output-file ...` — verify the receipt, sign the plaintext digest,
   publish proof, and close the Issue

## Verification

| Step | Check |
| --- | --- |
| Input | `sha256(decrypted input) == task.input.digest` |
| Output | `sha256(decrypted output) == proof.output_digest` |
| Revision | GitHub input is read from `delivery.github.input_commit` |
| Core | Proof signs `delivery_intent_digest` and task input/output binding |

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

Use `presigned-object-storage` as an escape hatch for trial nodes, environments
where collaborator access cannot be established, or deployments that reject
standing cross-repository permissions. Its GET URLs remain outside the public
Issue and should be delivered through a private channel.

The current delivery object binds one input digest, one immutable input
revision, and one output digest. HMAC authorization, credential intent, and
Ed25519 delivery proof include a digest of the delivery transport metadata.
Different artifact kinds are represented by capability media types. Multiple
output artifacts require a future extension and are not implied by the inbox
registry.

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
