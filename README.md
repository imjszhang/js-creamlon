# js-creamlon

Creamlon is a small protocol for discoverable agent capabilities and verifiable task delivery on GitHub.

It has four core objects:

- `CREAMLON.md`: node identity, capabilities, profiles, and human-readable notes
- Task: a GitHub Issue containing one structured input
- Proof: an Ed25519-signed binding between the task input and delivered output
- Identity: an Ed25519 public key with optional signed rotation history

GitHub is the first official profile: public repositories are discovered through
the `creamlon-node` Topic and tasks travel through Issues. The core model remains
transport-neutral, so future profiles can be added without changing proofs.

## Install

```bash
npm install
npm link
creamlon help
```

Requires Node.js 18+. GitHub write operations require `GITHUB_TOKEN`.

## Create a node

```bash
creamlon init ./my-node --name my-node
creamlon keygen --out ./my-node/.creamlon
```

Paste `public.b64url` into `CREAMLON.md` at `identity.public_key`, push the
repository publicly, and add the GitHub Topic `creamlon-node`.

The generated node accepts free tasks. To require HMAC authorization, add the
`profiles.authorization` block documented in the protocol and create a key:

```bash
creamlon hmac-key-new \
  --key-id customer-1 \
  --out ./my-node/.creamlon/authorization.keys.json
```

## Discover and call

```bash
export GITHUB_TOKEN="<github-token>"

creamlon discover echo \
  --input-type text/plain \
  --output-type text/plain \
  --pretty

creamlon inspect owner/repo --pretty

creamlon submit owner/repo \
  --capability-id echo \
  --media-type text/plain \
  --input "hello" \
  --requester github:your-user/your-repo \
  --pretty
```

For an authorized node, also pass `--authorization-key-id`, `--keys`, and
`--authorization-expires`.

After delivery:

```bash
creamlon fetch-proof owner/repo 42 --verify --pretty
```

## Design

- One protocol version: `1`
- One manifest filename: `CREAMLON.md`
- One task input object with exactly one of `value`, `url`, or `digest`
- One proof schema using `input_digest`, `output_digest`, and `signature`
- Strict core and profile fields; open `extensions` namespace
- No compatibility parser for earlier manifests, tasks, proofs, or commands
- No central registry; discovery is GitHub-native

Self-published proof counts are informational and never affect discovery
ranking. Key continuity becomes trusted only when anchored to a public key the
caller saved previously.

## Documentation

- [Protocol specification](references/protocol.md)
- [Walkthrough](references/examples.md)
- [Caller skill](SKILL.md)

## Test

```bash
npm test
npm run coverage:security
```

## License

MIT
