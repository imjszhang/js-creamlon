# Changelog

## 1.0.0

- Replaced the legacy manifest with one root-level `CREAMLON.md`.
- Added strict YAML front matter plus free-form Markdown documentation.
- Reduced the core protocol to manifest, task, proof, and identity.
- Added the official GitHub discovery and Issues transport profile.
- Unified task input as `media_type` plus exactly one of `value`, `url`, or `digest`.
- Standardized protocol objects on version `1` and explicit digest/signature names.
- Made HMAC authorization an optional declared profile; free nodes are supported.
- Reserved `extensions` as the open namespace for future integrations.
- Removed compatibility parsing and commands for pre-1.0 formats.
- Preserved signed proofs, key rotation continuity, resumable delivery, and local audit.
