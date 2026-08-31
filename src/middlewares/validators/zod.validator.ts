import { zValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import type { z } from "zod";
import { HTTP_STATUS } from "@/constants/error";
import { errorResponse } from "@/libs/response";

export default <T extends z.ZodType, Target extends keyof ValidationTargets>(
  target: Target,
  schema: T,
) => {
  return zValidator(target, schema, (result, c) => {
    if (!result.success) {
      return errorResponse(c, {
        status: HTTP_STATUS.UNPROCESSABLE_ENTITY,
        title: "Validation Error",
        message: JSON.parse(result.error.message),
      });
    }
  });
};
