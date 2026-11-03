/**
 * Cloudflare Worker entry for the GATEFIT-H25 collector and the GATEFIT-H30 status
 * probes. Thin glue around the pure handler, status checks, and D1 adapters. Minimal
 * local Cloudflare types keep this free of new dependencies; the repo tests never
 * import this file.
 */
import { d1Store, d1StatusStore, type D1Database } from "./d1-store.ts";
import { handleRequest } from "./handler.ts";
import { probePolarNow, runChecks } from "./status.ts";

interface Env {
  DB: D1Database;
}

interface ScheduledController {
  cron: string;
  scheduledTime: number;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

declare const caches: { default: Cache };

const ROLLUP_CRON = "15 0 * * *";

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const status = d1StatusStore(env.DB);
    // /v1/status is cached for 60 seconds, so page loads inside that window cost no D1 reads.
    // The handler sets the CORS headers before the put, so the cached copy carries them.
    if (req.method === "GET" && url.pathname === "/v1/status") {
      const key = new Request(`${url.origin}/v1/status`);
      const hit = await caches.default.match(key);
      if (hit) return hit;
      const res = await handleRequest(req, d1Store(env.DB), new Date(), status);
      if (res.status === 200) ctx.waitUntil(caches.default.put(key, res.clone()));
      return res;
    }
    return handleRequest(req, d1Store(env.DB), new Date(), status);
  },

  async scheduled(evt: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const status = d1StatusStore(env.DB);
    if (evt.cron === ROLLUP_CRON) {
      ctx.waitUntil(status.rollup(new Date(evt.scheduledTime)));
      return;
    }
    const rows = await runChecks(
      {
        fetch: (input, init) => fetch(input, init),
        // In-process check of the Worker and D1. A Worker fetching its own custom domain on
        // the same zone is unreliable, so this does not go over the network.
        selfCheck: () => handleRequest(new Request("https://t.gatefit.io/v1/stats?days=1"), d1Store(env.DB)),
      },
      { polar: probePolarNow(evt.scheduledTime) },
    );
    ctx.waitUntil(status.record(rows));
  },
};
