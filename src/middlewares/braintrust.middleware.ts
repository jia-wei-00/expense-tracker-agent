import { createMiddleware } from "hono/factory";
import { setupBraintrust } from "@/libs/braintrust";
import type { TAppEnv } from "@/types/common";

/** Braintrust tracing for a request; see `setupBraintrust` for the `waitUntil` bridge. */
export const braintrust = createMiddleware<TAppEnv>(async (c, next) => {
  setupBraintrust(c.env.BRAINTRUST_API_KEY, (promise) => {
    c.executionCtx.waitUntil(promise);
  });
  await next();
});
