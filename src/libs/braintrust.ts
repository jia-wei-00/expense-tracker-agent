import { initLogger } from "braintrust";

const VERCEL_WAIT_UNTIL = Symbol.for("@vercel/request-context");

let initialized = false;

/**
 * Braintrust tracing setup for Cloudflare Workers and Durable Objects.
 *
 * The Braintrust `workerd` build flushes logs asynchronously and keeps the
 * flush alive via `waitUntil` imported from `@vercel/functions`. That helper
 * reads Vercel's request context (`globalThis[Symbol.for("@vercel/request-context")]`),
 * which Workers never set, so it is a no-op and the buffered logs are dropped
 * when the isolate is frozen after the response. Bridging the symbol to the
 * caller's `waitUntil` (a request's `executionCtx` or a Durable Object's `ctx`)
 * lets the SDK's own flush complete.
 */
export function setupBraintrust(
  apiKey: string,
  waitUntil: (promise: Promise<unknown>) => void,
): void {
  Reflect.set(globalThis, VERCEL_WAIT_UNTIL, {
    get: () => ({ waitUntil }),
  });

  if (!initialized) {
    initLogger({ projectName: "spend-tracker-agent", apiKey });
    initialized = true;
  }
}
