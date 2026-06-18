#!/usr/bin/env node
import { runCli } from '../cli/index.mjs';

runCli(process.argv.slice(2)).catch((err) => {
  if (process.argv.includes('--json-errors')) {
    const exitCode = err.exitCode ?? 1;
    console.log(JSON.stringify({
      error: true,
      message: err.message || String(err),
      exit_code: exitCode,
    }));
    process.exit(exitCode);
  }
  console.error(err.message || String(err));
  process.exit(err.exitCode ?? 1);
});
