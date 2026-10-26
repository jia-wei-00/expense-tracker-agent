import { initLogger } from "braintrust";
import { createMiddleware } from "hono/factory";
import type { TAppEnv } from "@/types/common";

const VERCEL_WAIT_UNTIL = Symbol.for("@vercel/request-context");

let initialized = false;

/**
 * Braintrust tracing setup for Cloudflare Workers.
 *
 * The Braintrust `workerd` build flushes logs asynchronously and keeps the
 * flush alive via `waitUntil` imported from `@vercel/functions`. That helper
 * reads Vercel's request context (`globalThis[Symbol.for("@vercel/request-context")]`),
 * which Workers never set, so it is a no-op and the buffered logs are dropped
 * when the isolate is frozen after the response. Bridging the symbol to
 * Cloudflare's `ctx.waitUntil` lets the SDK's own flush complete.
 */
export const braintrust = createMiddleware<TAppEnv>(async (c, next) => {
  Reflect.set(globalThis, VERCEL_WAIT_UNTIL, {
    get: () => ({
      waitUntil: (promise: Promise<unknown>) =>
        c.executionCtx.waitUntil(promise),
    }),
  });

  if (!initialized) {
    initLogger({
      projectName: "spend-tracker-agent",
      apiKey: c.env.BRAINTRUST_API_KEY,
    });
    initialized = true;
  }

  await next();
});
