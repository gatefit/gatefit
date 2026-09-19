#!/usr/bin/env node
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "src/cli.ts");
const requireFromPackage = createRequire(path.join(root, "package.json"));

function resolveTsxCli() {
  try {
    return path.join(path.dirname(requireFromPackage.resolve("tsx/package.json")), "dist/cli.mjs");
  } catch {
    return undefined;
  }
}

const tsxCli = resolveTsxCli();
if (!tsxCli) {
  console.error("gatefit: missing tsx (run npm install so the gatefit package can resolve tsx)");
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
