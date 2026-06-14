# Changelog

## 0.1.0

- Initial npm and CLI release version `0.1.0`; protocol schema version remains `"1"`.
- Replaced the legacy manifest with one root-level `creamlon.yaml`.
- Added one strict, machine-readable YAML manifest.
- Reduced the core protocol to manifest, task, proof, and identity.
- Added the official GitHub discovery and Issues transport profile.
- Unified task input as `media_type` plus exactly one of `value`, `url`, or `digest`.
- Standardized protocol objects on version `1` and explicit digest/signature names.
- Made HMAC authorization an optional declared profile; free nodes are supported.
- Reserved `extensions` as the open namespace for future integrations.
- Removed compatibility parsing and commands for legacy formats.
- Preserved signed proofs, key rotation continuity, resumable delivery, and local audit.
- Added one installable `creamlon-skill` for caller and node workflows.
- Added automatic synchronization and validation for pinned npm release versions.
