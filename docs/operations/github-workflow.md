---
title: GitHub workflow
audience: maintainers
status: current
verified: 0.8.0
---

# GitHub workflow

Use this workflow for repository changes, protocol maintenance, and releases.
It keeps review, CI, and compatibility checks visible before `main` changes.

## Branches

Create one branch per change:

```bash
git checkout main
git pull --ff-only origin main
git checkout -b chore/example-change
```

Commit focused changes and push the branch:

```bash
git add .
git commit -m "test: pin protocol compatibility fixture"
git push -u origin chore/example-change
```

## Pull requests

Create a pull request with GitHub CLI when authenticated:

```bash
gh auth login
gh pr create --base main --head chore/example-change
```

Before requesting merge, run the release check locally:

```bash
npm run check:release
```

This runs version pin checks, documentation checks, syntax checks, tests,
security coverage, and `npm pack --dry-run`.

## CI expectations

Every pull request should pass:

- documentation checks
- tests on Node 18, 20, 22, and 24
- package dry run
- npm audit at high severity
- installable skill checks
- security coverage
- secret scanning
- the aggregate release check

If CI fails after `main` moves, merge or rebase `origin/main`, fix any release
guard failures, run `npm run check:release`, and push the branch again.

## Merge policy

Prefer pull request merges over direct pushes to `main`. The `main` branch
should remain releasable and should not contain unreviewed compatibility
changes.

Recommended branch protection:

- require pull requests before merging
- require status checks to pass
- require branches to be up to date before merging
- block force-pushes
- block branch deletion

## Release flow

Prepare a release on a branch:

```bash
npm version patch
npm run check:release
git push --follow-tags
```

Publish only after CI passes for the release commit:

```bash
npm publish
gh release create v0.6.1 --generate-notes
```

For protocol-facing changes, review
[Protocol compatibility](./protocol-compatibility.md) before versioning. Use a
new extension, scheme, or protocol version when a change would break a
published version 1 wire contract.
