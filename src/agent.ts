import { HTTP_STATUS } from "@/constants/error";
import { successResponse } from "@/libs/response";
import { TAgentPrompt } from "./types/agent";
import { ValidContext } from "./types/common";

export async function agentPrompt(c: ValidContext<TAgentPrompt>) {
  return successResponse(c, {
    status: HTTP_STATUS.OK,
    message: "Agent endpoint",
  });
}
