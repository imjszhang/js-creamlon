# Contributing

Use Node.js 18 or newer.

```bash
npm ci
npm test
npm pack --dry-run
```

Protocol changes must update the specification and include tests for tampering, replay, malformed input, and failure recovery where applicable.
