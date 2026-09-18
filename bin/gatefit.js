#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const tsxCli = path.join(root, "node_modules/tsx/dist/cli.mjs");
const cli = path.join(root, "src/cli.ts");
const result = spawnSync(process.execPath, [tsxCli, cli, ...process.argv.slice(2)], {
  stdio: "inherit",
  cwd: root,
  env: process.env,
});
process.exit(result.status === null ? 1 : result.status);
