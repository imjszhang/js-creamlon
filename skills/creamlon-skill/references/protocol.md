# Creamlon Protocol Reference

Creamlon protocol objects use schema version `"1"`.

- A node publishes `creamlon.yaml`.
- GitHub discovery uses the Topic `creamlon-node`.
- Tasks are Issues titled `[task] <capability_id>`.
- Input contains `media_type` and one of `value`, `url`, or `digest`.
- Delivery proofs bind `request_id`, capability, input digest, output digest,
  completion time, and the node's Ed25519 identity.
- HMAC authorization is required only when declared by the node.
- Proof history is self-published and does not establish output quality.

The full specification is available at:
https://github.com/imjszhang/js-creamlon/blob/main/references/protocol.md
