import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function packageRoot(): string {
  return process.env.GATEFIT_PACKAGE_ROOT ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
}

export function userCwd(): string {
  return process.env.INIT_CWD ?? process.cwd();
}

export function goldenDir(): string {
  return path.join(packageRoot(), "tests/entitlements/goldens");
}

export function readPackageVersion(): string {
  const raw = fs.readFileSync(path.join(packageRoot(), "package.json"), "utf8");
  const pkg = JSON.parse(raw) as { version?: string };
  if (!pkg.version) throw new Error("package.json missing version");
  return pkg.version;
}

export function resolveUserOrPackage(spec: string): string {
  if (path.isAbsolute(spec) && fs.existsSync(spec)) return spec;
  const fromUser = path.resolve(userCwd(), spec);
  if (fs.existsSync(fromUser)) return fromUser;
  const fromPkg = path.resolve(packageRoot(), spec);
  if (fs.existsSync(fromPkg)) return fromPkg;
  throw new Error(`path not found: ${spec}`);
}
