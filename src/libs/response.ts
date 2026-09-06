import type { Context } from "hono";
import { HTTP_STATUS } from "@/constants/error";
import type {
  ApiSuccessResponse,
  ErrorResponse,
  SuccessOptions,
} from "@/types/api-response";

/**
 * Builds a standardized 2xx success response.
 *
 * @example
 * // 200 OK with only data
 * return successResponse(c, { data: { id: 1, name: "Lunch" } });
 *
 * @example
 * // 201 Created with a message and no data
 * return successResponse(c, {
 *   status: HTTP_STATUS.CREATED,
 *   message: "Expense created",
 * });
 *
 * @example
 * // 204 No Content (empty body)
 * return successResponse(c, { status: HTTP_STATUS.NO_CONTENT });
 *
 * @param c - The Hono context to respond with.
 * @param options - Response options. `status` defaults to `HTTP_STATUS.OK` (200).
 * @param options.status - HTTP status to return (see `HTTP_STATUS` in `@/constants/error`).
 * @param options.message - Optional human-readable message; omitted from the body when falsy.
 * @param options.data - Optional payload; omitted from the body when `undefined`.
 * @returns A JSON `ApiSuccessResponse<T>` response with `success: true`.
 */
export function successResponse<T>(
  c: Context,
  { status = HTTP_STATUS.OK, message, data }: SuccessOptions<T>,
) {
  const response: ApiSuccessResponse<T> = {
    success: true,
    ...(message ? { message } : {}),
    ...(data !== undefined ? { data } : {}),
  };

  return c.json(response, status);
}

/**
 * Builds an RFC 9457 `application/problem+json` error response.
 *
 * @example
 * // 404 Not Found
 * return errorResponse(c, {
 *   status: HTTP_STATUS.NOT_FOUND,
 *   title: "Expense not found",
 *   detail: "No expense exists with id 42.",
 * });
 *
 * @example
 * // 422 Validation error, with a per-request instance URI
 * return errorResponse(c, {
 *   status: HTTP_STATUS.UNPROCESSABLE_ENTITY,
 *   title: "Validation failed",
 *   detail: "amount must be a positive number.",
 *   instance: "/expenses/42",
 * });
 *
 * @param c - The Hono context to respond with.
 * @param options - Error options; optional (see `ErrorResponse` in `@/types/api-response`).
 * @param options.status - HTTP status to return; must be a `ContentfulStatusCode` (see `HTTP_STATUS` in `@/constants/error`). Defaults to `HTTP_STATUS.INTERNAL_SERVER_ERROR` (500).
 * @param options.title - Short, human-readable problem summary; omitted when falsy.
 * @param options.detail - Longer explanation specific to this occurrence; omitted when falsy.
 * @param options.instance - URI reference identifying the specific occurrence; omitted when falsy.
 * @param options.message - Optional message field for clients that prefer plain `message`; omitted when falsy.
 * @returns A JSON response with the `Content-Type` header set to `application/problem+json`.
 */
export function errorResponse(
  c: Context,
  {
    status = HTTP_STATUS.INTERNAL_SERVER_ERROR,
    title,
    detail,
    instance,
    message,
  }: ErrorResponse = {},
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
