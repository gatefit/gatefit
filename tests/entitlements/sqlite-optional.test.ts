import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const root = path.join(import.meta.dirname, "../..");

type PackageJson = {
  version?: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.NPM_TOKEN;
  delete env.NODE_AUTH_TOKEN;
  delete env.GATEFIT_LIVE_CLOCK;
  delete env.GATEFIT_LICENSE_KEY;
  delete env.GATEFIT_PACKAGE_ROOT;
  delete env.INIT_CWD;
  delete env.NODE_PATH;
  return env;
}

function eachBetterSqlite3(dir: string, visit: (pkgDir: string) => void): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === ".bin") continue;
    const full = path.join(dir, entry.name);
    if (entry.name === "better-sqlite3") {
      visit(full);
      continue;
    }
    if (entry.name === "node_modules" || entry.name.startsWith("@")) {
      eachBetterSqlite3(full, visit);
      continue;
    }
    const nested = path.join(full, "node_modules");
    if (fs.existsSync(nested)) eachBetterSqlite3(nested, visit);
  }
}

function run(bin: string, args: string[], cwd: string) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd,
    encoding: "utf8",
    env: cleanEnv(),
  });
}

test(
  "packed install without a native build still runs version, help, and adapter-check",
  { timeout: 180_000 },
  () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as PackageJson;
    assert.equal(pkg.version, "0.5.1");
    assert.equal(pkg.dependencies?.["better-sqlite3"], undefined);
    assert.equal(pkg.optionalDependencies?.["better-sqlite3"], "^13.0.3");

    const work = fs.mkdtempSync(path.join(os.tmpdir(), "gatefit-optional-"));
    try {
      const packed = spawnSync("npm", ["pack", "--json", "--pack-destination", work], {
        cwd: root,
        encoding: "utf8",
        env: cleanEnv(),
      });
      assert.equal(packed.status, 0, packed.stderr);
      const listed = JSON.parse(packed.stdout) as { filename: string }[];
      const tgzName = listed[0]?.filename;
      assert.equal(tgzName, "gatefit-0.5.1.tgz");
      const tgz = path.join(work, tgzName!);
      const listing = execFileSync("tar", ["-tzf", tgz], { encoding: "utf8" });
      assert.match(listing, /package\/bin\/gatefit\.js/);
      assert.doesNotMatch(listing, /(^|\/)site\//);
      assert.doesNotMatch(listing, /(^|\/)\.env($|\.)/);
      assert.doesNotMatch(listing, /sk_live_[A-Za-z0-9]{8,}|npm_[A-Za-z0-9]{8,}|BEGIN [A-Z ]*PRIVATE KEY/);

      const installDir = path.join(work, "app");
      fs.mkdirSync(installDir);
      const installed = spawnSync(
        "npm",
        ["install", "--ignore-scripts", "--no-fund", "--no-audit", "--no-package-lock", tgz],
        { cwd: installDir, encoding: "utf8", env: cleanEnv() },
      );
      assert.equal(installed.status, 0, installed.stderr);

      const packedPkg = JSON.parse(
        fs.readFileSync(path.join(installDir, "node_modules/gatefit/package.json"), "utf8"),
      ) as PackageJson;
      assert.equal(packedPkg.dependencies?.["better-sqlite3"], undefined);
      assert.ok(packedPkg.optionalDependencies?.["better-sqlite3"]);

      const bin = path.join(installDir, "node_modules/gatefit/bin/gatefit.js");
      const version = run(bin, ["--version"], installDir);
      assert.equal(version.status, 0, version.stderr);
      assert.match(version.stdout, /^gatefit 0\.5\.1\n?$/);

      const help = run(bin, ["--help"], installDir);
      assert.equal(help.status, 0, help.stderr + help.stdout);
      assert.match(`${help.stdout}${help.stderr}`, /adapter-check/);
      assert.doesNotMatch(`${help.stdout}${help.stderr}`, /better-sqlite3/);

      const check = run(bin, ["adapter-check"], installDir);
      assert.equal(check.status, 0, check.stderr + check.stdout);
      assert.match(check.stderr, /naive failed S1/);
      assert.match(check.stderr, /hardened passed S1/);

      const sqliteArgs = ["run", "--suite", "paid_grants_access", "--adapter", "src/adapters/sqlite.ts"];
      let stripped = 0;
      eachBetterSqlite3(path.join(installDir, "node_modules"), (pkgDir) => {
        stripped += 1;
        fs.rmSync(path.join(pkgDir, "prebuilds"), { recursive: true, force: true });
        fs.rmSync(path.join(pkgDir, "build"), { recursive: true, force: true });
      });
      assert.ok(stripped > 0, "install did not include better-sqlite3");
      const bindingMissing = run(bin, sqliteArgs, installDir);
      assert.notEqual(bindingMissing.status, 0);
      assert.equal(bindingMissing.stdout, "");
      assertSqliteError(bindingMissing.stderr);

      eachBetterSqlite3(path.join(installDir, "node_modules"), (pkgDir) => {
        fs.rmSync(pkgDir, { recursive: true, force: true });
      });
      const moduleMissing = run(bin, sqliteArgs, installDir);
      assert.notEqual(moduleMissing.status, 0);
      assert.equal(moduleMissing.stdout, "");
      assertSqliteError(moduleMissing.stderr);

      const stillVersion = run(bin, ["--version"], installDir);
      assert.equal(stillVersion.status, 0, stillVersion.stderr);
      assert.match(stillVersion.stdout, /gatefit 0\.5\.1/);
      const stillCheck = run(bin, ["adapter-check"], installDir);
      assert.equal(stillCheck.status, 0, stillCheck.stderr);
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  },
);

function assertSqliteError(stderr: string): void {
  assert.notEqual(stderr.trim(), "");
  assert.match(stderr, /better-sqlite3/);
  assert.match(stderr, /optional/);
  assert.match(stderr, /prebuild/);
  assert.match(stderr, /npm run build-release/);
  assert.match(stderr, /npm rebuild better-sqlite3 does not compile/);
  assert.match(stderr, /C\+\+|compiler|Xcode|build-essential|make/);
  assert.match(stderr, /--version/);
}
