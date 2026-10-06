import { useEffect, useState } from "react";
import { sensesApi, type ModelSense } from "@/api/assistant/senses";
import type { GlobalAiConversation } from "@/features/global-search/types";
import { useMistyStore } from "@/features/misty/useMistyStore";
import { runtimeAssistantApi as assistantApi } from "../AgentsRuntime";
import { ModelPicker } from "./ModelPicker";

/**
 * The composer's model switch. A conversation keeps its own pick; before the
 * conversation exists, the pick rides along with the first message.
 */
export function ConversationModelPicker({
  conversation,
  disabled,
  onError,
}: {
  conversation?: GlobalAiConversation;
  disabled?: boolean;
  onError(message: string): void;
}) {
  const [thinking, setThinking] = useState<ModelSense>();
  const pending = useMistyStore((s) => s.pendingModelOverride);
  useEffect(() => {
    let active = true;
    sensesApi
      .list()
      .then((result) => active && setThinking(result.senses.find((s) => s.id === "thinking")))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  // Without the catalog there is nothing to choose from.
  if (!thinking) return null;
  const saved = conversation && !conversation.id.startsWith("local-") ? conversation : undefined;
  const value = saved ? (saved.modelOverride ?? "") : (pending ?? "");
  const fallback = thinking.model || thinking.default_model;
  const patch = (id: string, model: string) =>
    useMistyStore.setState((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === id ? { ...c, modelOverride: model, modelId: model || fallback } : c,
      ),
    }));
  const choose = async (model: string) => {
    if (!saved) {
      useMistyStore.setState({ pendingModelOverride: model || undefined });
      return;
    }
    const previous = saved.modelOverride ?? "";
    patch(saved.id, model);
    try {
      await assistantApi.updateConversationModel(saved.id, model);
    } catch (reason) {
      patch(saved.id, previous);
      onError(reason instanceof Error ? reason.message : "Could not switch models. Try again.");
    }
  };
  return (
    <ModelPicker
      label="Model for this conversation"
      options={thinking.options}
      value={value}
      defaultModel={fallback}
      defaultLabel="Default"
      disabled={disabled}
      className="h-7 px-2 text-xs text-cream-muted"
      onChange={(model) => void choose(model)}
    />
  );
}
