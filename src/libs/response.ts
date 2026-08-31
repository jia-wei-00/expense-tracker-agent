import type { Context } from "hono";
import { HTTP_STATUS } from "@/constants/error";
import type {
  ApiSuccessResponse,
  ErrorResponse,
  SuccessOptions,
} from "@/types/api-response";

export function successResponse<T>(
  c: Context,
  { status = HTTP_STATUS.OK, message, data }: SuccessOptions<T>,
) {
  if (status === HTTP_STATUS.NO_CONTENT) {
    return c.body(null, status);
  }

  const response: ApiSuccessResponse<T> = {
    success: true,
    ...(message ? { message } : {}),
    ...(data !== undefined ? { data } : {}),
  };

  return c.json(response, status);
}

export function errorResponse(
  c: Context,
  { status, title, detail, instance, message }: ErrorResponse,
) {
  const response = {
    status,
    ...(title ? { title } : {}),
    ...(detail ? { detail } : {}),
    ...(instance ? { instance } : {}),
    ...(message ? { message } : {}),
  };

  return c.json(response, status, {
    "Content-Type": "application/problem+json",
  });
}
