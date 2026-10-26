import type { ContentfulStatusCode } from "hono/utils/http-status";

/** A request-level failure that maps to a problem+json response. */
export class ChatError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly title: string,
    readonly detail?: string,
    /** RFC 9457 extension members, e.g. quota details on a 429. */
    readonly extensions?: Record<string, string | number | boolean>,
  ) {
    super(title);
  }
}
