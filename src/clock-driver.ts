import {
  assertAdvanceWithinTwoIntervals,
  MONTH_SECONDS,
  type StripeClockClient,
  type TestClock,
} from "./stripe-clock.ts";

export type ClockWaitOpts = {
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  intervalMs?: number;
};

export async function withTestClock<T>(
  client: StripeClockClient,
  input: { frozenTime: number; name?: string },
  fn: (clock: TestClock) => Promise<T>,
): Promise<T> {
  const clock = await client.createClock(input);
  try {
    return await fn(clock);
  } finally {
    const deleted = await client.deleteClock(clock.id);
    if (!deleted?.deleted) {
      throw new Error(`clock leak: failed to delete ${clock.id}`);
    }
  }
}

export async function advanceUntilReady(
  client: StripeClockClient,
  clockId: string,
  frozenTime: number,
  opts: ClockWaitOpts = {},
): Promise<TestClock> {
  const current = await client.retrieveClock(clockId);
  assertAdvanceWithinTwoIntervals(current.frozen_time, frozenTime, MONTH_SECONDS);
  await client.advanceClock(clockId, frozenTime);
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const intervalMs = opts.intervalMs ?? 500;
  const deadline = Date.now() + timeoutMs;
  let clock = await client.retrieveClock(clockId);
  while (clock.status !== "ready") {
    if (Date.now() > deadline) {
      throw new Error(`clock ${clockId} did not become ready before timeout`);
    }
    await sleep(intervalMs);
    clock = await client.retrieveClock(clockId);
  }
  return clock;
}
