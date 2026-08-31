import type { ContentfulStatusCode, StatusCode } from "hono/utils/http-status";
import z from "zod";

export type ApiSuccessResponse<T> = {
  success: true;
  message?: string;
  data?: T;
};

export type SuccessOptions<T> = {
  status?: StatusCode;
  message?: string;
  data?: T;
};

export type ErrorResponse = {
  status: ContentfulStatusCode;
  title?: string;
  detail?: string;
  instance?: string;
  message?: string;
};
