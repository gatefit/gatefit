import { spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

// Throwaway local Postgres for the init Postgres lane. Trust auth on 127.0.0.1,
// data dir under the OS temp dir, stopped and removed by stop(). No password,
// no network listener beyond loopback, nothing written to the repo.

export type EphemeralPg = {
  url: string;
  psql(sql: string): string;
  psqlFile(file: string): string;
  stop(): void;
};

function hasPgBinaries(dir: string): boolean {
  return ["initdb", "pg_ctl", "psql"].every((name) => fs.existsSync(path.join(dir, name)));
}

/** Directory holding initdb, pg_ctl, and psql, or undefined when none is installed. */
export function findPgBinDir(): string | undefined {
  const fromEnv = process.env.GATEFIT_PG_BIN;
  if (fromEnv && hasPgBinaries(fromEnv)) return fromEnv;
  const config = spawnSync("pg_config", ["--bindir"], { encoding: "utf8" });
  if (config.status === 0) {
    const dir = config.stdout.trim();
    if (hasPgBinaries(dir)) return dir;
  }
  const debianRoot = "/usr/lib/postgresql";
  if (fs.existsSync(debianRoot)) {
    const versions = fs
      .readdirSync(debianRoot)
      .filter((v) => /^\d+$/.test(v))
      .sort((a, b) => Number(b) - Number(a));
    for (const v of versions) {
      const dir = path.join(debianRoot, v, "bin");
      if (hasPgBinaries(dir)) return dir;
    }
  }
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (dir && hasPgBinaries(dir)) return dir;
  }
  return undefined;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function must(bin: string, args: string[], label: string): string {
  const result = spawnSync(bin, args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${label} failed (${result.status}): ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

export async function startEphemeralPg(binDir: string, database = "gatefit"): Promise<EphemeralPg> {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "gatefit-pg-"));
  const data = path.join(base, "data");
  const sock = path.join(base, "sock");
  const bin = (name: string) => path.join(binDir, name);
  let stopped = false;
  const teardown = () => {
    if (stopped) return;
    stopped = true;
    if (fs.existsSync(path.join(data, "postmaster.pid"))) {
      spawnSync(bin("pg_ctl"), ["-D", data, "-m", "immediate", "-w", "stop"], { encoding: "utf8" });
    }
    fs.rmSync(base, { recursive: true, force: true });
  };
  let url: string;
  try {
    fs.mkdirSync(sock);
    const port = await freePort();
    must(bin("initdb"), ["-D", data, "-A", "trust", "-U", "postgres", "--no-sync", "-E", "UTF8"], "initdb");
    must(
      bin("pg_ctl"),
      [
        "-D",
        data,
        "-l",
        path.join(base, "pg.log"),
        "-w",
        "-o",
        `-p ${port} -k ${sock} -c listen_addresses=127.0.0.1 -c fsync=off`,
        "start",
      ],
      "pg_ctl start",
    );
    const admin = `postgres://postgres@127.0.0.1:${port}/postgres`;
    must(bin("psql"), [admin, "-v", "ON_ERROR_STOP=1", "-qc", `CREATE DATABASE ${database}`], "createdb");
    url = `postgres://postgres@127.0.0.1:${port}/${database}`;
  } catch (err) {
    // A failed start must not leave a running server or a temp dir behind.
    teardown();
    throw err;
  }
  return {
    url,
    psql(sql: string) {
      return must(bin("psql"), [url, "-v", "ON_ERROR_STOP=1", "-qAtc", sql], "psql");
    },
    psqlFile(file: string) {
      return must(bin("psql"), [url, "-v", "ON_ERROR_STOP=1", "-qAtf", file], "psql -f");
    },
    stop: teardown,
  };
}
