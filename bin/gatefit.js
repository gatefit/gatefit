#!/usr/bin/env node
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const tsxCli = path.join(root, "node_modules/tsx/dist/cli.mjs");
const cli = path.join(root, "src/cli.ts");
if (!fs.existsSync(tsxCli)) {
  console.error("gatefit: missing tsx (run npm install in the gatefit package)");
  process.exit(1);
}
process.env.GATEFIT_PACKAGE_ROOT ??= root;
process.env.INIT_CWD ??= process.cwd();
const result = spawnSync(process.execPath, [tsxCli, cli, ...process.argv.slice(2)], {
  stdio: "inherit",
  cwd: process.cwd(),
  env: process.env,
});
process.exit(result.status === null ? 1 : result.status);
