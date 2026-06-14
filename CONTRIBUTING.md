# Contributing

Use Node.js 18 or newer.

```bash
npm ci
npm test
npm pack --dry-run
```

Protocol changes must update the specification and include tests for tampering,
replay, malformed input, secret leakage, concurrent redemption, and failure
recovery where applicable.

## Release

Keep the npm release version independent from protocol schema version `"1"`.
Start a release from a clean `main` branch:

```bash
npm version patch
npm publish
git push --follow-tags
```

Use `minor` or `major` instead of `patch` when required by semantic versioning.
The npm version lifecycle synchronizes pinned CLI examples in the README, Skill,
and node template. Add the matching release notes to `CHANGELOG.md` before
running `npm version`.
