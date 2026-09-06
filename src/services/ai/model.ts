import { ICreateModelAgent } from "@/types/ai";
import {
  getGeminiConfig,
  getMercuryConfig,
  getNvidiaConfig,
} from "../../constants/model-config";
import { createAgent } from "@/utils/model";

export const createGenAiAgent = ({ env, ...rest }: ICreateModelAgent) =>
  createAgent({ ...rest, ...getGeminiConfig(env) });

export const createMercuryAgent = ({ env, ...rest }: ICreateModelAgent) =>
  createAgent({ ...rest, ...getMercuryConfig(env) });

export const createNvidiaAgent = ({ env, ...rest }: ICreateModelAgent) =>
  createAgent({ ...rest, ...getNvidiaConfig(env) });

export const createEmbeddingAgent = ({ env, ...rest }: ICreateModelAgent) =>
  createAgent({ ...rest, ...getNvidiaConfig(env) });
