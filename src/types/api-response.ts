import type { ContentfulStatusCode } from "hono/utils/http-status";

export type TApiSuccessResponse<T> = {
  success: true;
  message?: string;
  data?: T;
};

export type TSuccessOptions<T> = {
  status?: ContentfulStatusCode;
  message?: string;
  data?: T;
};

export type TErrorResponse = {
  status?: ContentfulStatusCode;
  title?: string;
  detail?: string;
  instance?: string;
  message?: string;
  /** RFC 9457 extension members, spread into the problem body as-is. */
  extensions?: Record<string, string | number | boolean>;
};
