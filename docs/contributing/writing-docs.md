---
title: Writing documentation
audience: contributors
status: current
verified: 0.8.1
---

# Writing documentation

Update user documentation in the same pull request as user-visible code,
configuration, protocol, CLI, or security behavior.

## Choose the right page type

- Quickstart: shortest path to a first successful result
- Guide: one user goal from prerequisites through verification
- Concept: mental model and design boundaries
- Reference: authoritative facts and option lookup
- Operations: security, recovery, upgrades, and maintenance
- Troubleshooting: symptoms, likely causes, and corrective actions

Do not organize user documentation around internal source modules.

## Required metadata

Every Markdown file under `docs/` starts with:

```yaml
---
title: Page title
audience: primary readers
status: current
verified: 0.5.0
---
```

Use `experimental` for unstable behavior and `deprecated` for behavior being
removed. Change `verified` only after reviewing the page against that package
version.

## Writing requirements

- State prerequisites before steps.
- Use commands that can be copied without hidden context.
- Describe an observable success result.
- Mark public data and secret-handling boundaries.
- Link to normative protocol or extension documents instead of restating them.
- Prefer `creamlon help <command>` over duplicating complete option lists.
- Use repository-relative links and descriptive link text.
- Keep examples aligned with the minimum supported Node.js version.

## Review checklist

- The target user can identify the page from `docs/README.md`.
- Commands and output claims match the release candidate.
- Version and stability metadata are accurate.
- New or changed secrets have explicit handling guidance.
- Breaking changes include migration notes in `CHANGELOG.md`.
- `npm run check:docs` and the project test suite pass.

## Version maintenance

The release owner reviews all pages and updates `verified` after validation.
`npm run check:docs:release` requires every page to match the package version
before publication. Git tags preserve released documentation; do not create
copied version directories unless the project begins supporting multiple
release lines.
