import type { ContentfulStatusCode } from "hono/utils/http-status";

/** A request-level failure that maps to a problem+json response. */
export class ChatError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly title: string,
    readonly detail?: string,
  ) {
    super(title);
  }
}
