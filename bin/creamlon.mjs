#!/usr/bin/env node
import { runCli } from '../cli/index.mjs';

runCli(process.argv.slice(2)).catch((err) => {
  console.error(err.message || String(err));
  process.exit(err.exitCode ?? 1);
});
