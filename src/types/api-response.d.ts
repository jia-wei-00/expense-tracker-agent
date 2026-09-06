import type { ContentfulStatusCode } from "hono/utils/http-status";
import z from "zod";

export type ApiSuccessResponse<T> = {
  success: true;
  message?: string;
  data?: T;
};

export type SuccessOptions<T> = {
  status?: ContentfulStatusCode;
  message?: string;
  data?: T;
};

export type ErrorResponse = {
  status?: ContentfulStatusCode;
  title?: string;
  detail?: string;
  instance?: string;
  message?: string;
};
