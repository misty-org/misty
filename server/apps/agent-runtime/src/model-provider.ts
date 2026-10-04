import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModelV4, LanguageModelV4CallOptions } from "@ai-sdk/provider";
import { createGateway } from "ai";
import type { RuntimeIdentity } from "./control-plane.js";

type Environment = Record<string, string | undefined>;

/** Instance AI always bills the AI Gateway; accounts bring their own keys. */
export function instanceModelConfig(env: Environment = process.env) {
  const model = env.MISTY_AGENT_MODEL?.trim() || "";
  if (model && (!/^[^\s/]+\/\S+$/.test(model) || model.length > 200)) {
    throw new Error("MISTY_AGENT_MODEL must be a provider/model ID");
  }
  return { provider: "gateway", model };
}

export function resolveInstanceModel(
  modelId: string,
  options: LanguageModelV4CallOptions,
  env: Environment = process.env,
): { model: LanguageModelV4; options: LanguageModelV4CallOptions } {
  return resolveProviderModel(modelId, options, instanceModelConfig(env), env);
}

export interface AccountModelConfig {
  provider: string;
  model: string;
  baseURL?: string;
  apiKey?: string;
  reasoning?: string;
}

/** Resolve credentials in the Node model step, never in the workflow bundle. */
export async function resolveRuntimeModel(
  modelId: string,
  options: LanguageModelV4CallOptions,
  identity?: RuntimeIdentity,
  role: "agent" | "vision" = "agent",
): Promise<{ model: LanguageModelV4; options: LanguageModelV4CallOptions }> {
  if (!identity) return resolveInstanceModel(modelId, options);
  const { controlPlaneRequest } = await import("./control-plane.js");
  const config = await controlPlaneRequest<AccountModelConfig>(
    identity,
    "model-provider",
    { role, model: modelId },
    `${role}:provider`,
  );
  if (config.provider === "instance")
    return resolveInstanceModel(modelId, {
      ...options,
      reasoning: config.reasoning as LanguageModelV4CallOptions["reasoning"],
    });
  const { providerFetch } = await import("./provider-fetch.js");
  return resolveProviderModel(
    modelId,
    options,
    config,
    {},
    providerFetch(
      config.provider === "gateway"
        ? config.baseURL!.replace(/\/v1\/?$/, "/v4/ai")
        : config.baseURL!,
    ),
  );
}

export function resolveProviderModel(
  modelId: string,
  options: LanguageModelV4CallOptions,
  config: AccountModelConfig,
  env: Environment = process.env,
  accountFetch?: typeof fetch,
): { model: LanguageModelV4; options: LanguageModelV4CallOptions } {
  if (config.provider === "gateway") {
    const gateway = createGateway({
      apiKey:
        config.apiKey ||
        env.AI_GATEWAY_API_KEY?.trim() ||
        env.VERCEL_OIDC_TOKEN?.trim() ||
        undefined,
      baseURL: accountFetch
        ? config.baseURL?.replace(/\/v1\/?$/, "/v4/ai")
        : env.AI_GATEWAY_BASE_URL?.trim() || undefined,
      fetch: accountFetch,
    });
    return {
      model: gateway(modelId),
      options: accountFetch
        ? {
            ...options,
            reasoning:
              config.reasoning === "max"
                ? undefined
                : (config.reasoning as LanguageModelV4CallOptions["reasoning"]),
            providerOptions:
              config.reasoning === "max" ? { openai: { reasoningEffort: "max" } } : {},
          }
        : options,
    };
  }
  if (modelId !== config.model)
    throw new Error("Requested model is not configured for this connection");
  const nativeId = modelId.slice(config.provider.length + 1);
  const settings = { apiKey: config.apiKey, baseURL: config.baseURL, fetch: accountFetch };
  let model: LanguageModelV4;
  switch (config.provider) {
    case "openai":
      model = createOpenAI(settings).responses(nativeId);
      break;
    case "anthropic":
      model = createAnthropic(settings)(nativeId);
      break;
    case "google":
      model = createGoogleGenerativeAI(settings)(nativeId);
      break;
    default:
      model = createOpenAICompatible({
        ...settings,
        name: "openai-compatible",
        baseURL: config.baseURL!,
      })(nativeId);
  }
  // An account request never falls back to a different provider or Gateway bill.
  const { gateway: _gateway, ...providerOptions } = options.providerOptions ?? {};
  if (config.provider === "openai" && config.reasoning)
    providerOptions.openai = { ...providerOptions.openai, reasoningEffort: config.reasoning };
  if (config.provider === "openai-compatible" && config.reasoning)
    providerOptions.openaiCompatible = { reasoningEffort: config.reasoning };
  return {
    model,
    options: {
      ...options,
      // Responses normalizes an omitted strict flag, which can turn optional
      // capability arguments into required fields. Preserve the admitted schema
      // unless the caller explicitly requested strict function calling.
      tools:
        config.provider === "openai"
          ? options.tools?.map((tool) =>
              tool.type === "function" && tool.strict == null ? { ...tool, strict: false } : tool,
            )
          : options.tools,
      providerOptions,
      reasoning:
        config.provider === "openai-compatible" || config.reasoning === "max"
          ? undefined
          : ((config.reasoning || undefined) as LanguageModelV4CallOptions["reasoning"]),
    },
  };
}
