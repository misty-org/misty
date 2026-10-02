export interface FrontierModel {
  id: string;
  name: string;
  provider_id: string;
  provider_name: string;
  capabilities: string[];
  reasoning_levels: Array<"default" | "low" | "medium" | "high" | "xhigh">;
}

export interface FrontierModelCatalog {
  catalog_version: string;
  default_model_id: string;
  models: FrontierModel[];
}

export interface AssistantTurnInput<TContext extends object = Record<string, unknown>> {
  mode: string;
  prompt: string;
  context: TContext[];
  timezone?: string;
}

export function safeAssistantTurnInput<TContext extends object>(
  input: AssistantTurnInput<TContext>,
) {
  return {
    mode: input.mode,
    prompt: input.prompt,
    context: input.context.map((context) => {
      const { localPath: _localPath, ...reference } = context as TContext & { localPath?: string };
      return reference;
    }),
    timezone: input.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC",
  };
}
