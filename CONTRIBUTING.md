# Contributing

Use Node.js 18 or newer.

```bash
npm ci
npm run check
npm pack --dry-run
```

Protocol changes must update the specification and include tests for tampering,
replay, malformed input, secret leakage, concurrent redemption, and failure
recovery where applicable.

User-visible behavior changes must update the relevant page under `docs/` in
the same pull request. Follow the [documentation guide](./docs/contributing/writing-docs.md)
for page metadata, review requirements, and version handling.

## Release

Keep the npm release version independent from protocol schema version `"1"`.
Start a release from a clean `main` branch:

```bash
npm version patch --no-git-tag-version
# Review every docs/ page and update its verified metadata.
npm run check:docs:release
git add package.json package-lock.json README.md skills template docs CHANGELOG.md
git commit -m "Release v$(node -p "require('./package.json').version")"
git tag "v$(node -p "require('./package.json').version")"
npm publish
git push --follow-tags
```

Use `minor` or `major` instead of `patch` when required by semantic versioning.
The npm version lifecycle synchronizes pinned CLI examples in the README, Skill,
and node template. Add the matching release notes to `CHANGELOG.md` before
running `npm version`.

Before publishing, review every affected user page against the release
candidate and update its `verified` metadata to the new package version.
`check:docs:release` blocks publication when any page is still marked as
verified against an older version. During the `0.x` release series, minor
releases may require explicit migration notes. Git tags preserve the
documentation for each release; do not copy release trees into `docs/`.
