import { runtimeAssistantApi as assistantApi } from "@/features/agents/agentsRuntime";
import { thinkingMode, thinkingEffort, type ThinkingMode } from "@/features/agents/thinkingMode";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/shared/ui";
import { Brain } from "lucide-react";
import { useState } from "react";

/** Compatibility export for existing composer slots; model selection is server-owned. */
export function MistyModelPicker(props: {
  inline?: boolean;
  conversationId?: string;
  modelId?: string;
  reasoningEffort?: string;
  disabled?: boolean;
  onChange: (settings: { modelId: string; reasoningEffort: "high" | "xhigh" }) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const selected = thinkingMode(props.reasoningEffort);
  const choose = async (mode: ThinkingMode) => {
    if (saving || props.disabled) return;
    setSaving(true);
    setError("");
    try {
      const response =
        props.conversationId && !props.conversationId.startsWith("local-")
          ? await assistantApi.updateConversationSettings(props.conversationId, {
              thinking_mode: mode,
            })
          : undefined;
      props.onChange({ modelId: response?.model_id ?? "", reasoningEffort: thinkingEffort(mode) });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not change thinking mode.");
    } finally {
      setSaving(false);
    }
  };
  const options = (["normal", "deep"] as const).map((mode) => ({
    mode,
    label: mode === "normal" ? "Normal" : "Deep thinking",
  }));
  if (props.inline)
    return (
      <div>
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="text-cream-muted">Thinking</span>
          <div role="group" aria-label="Thinking mode" className="flex items-center gap-1">
            {options.map(({ mode, label }) => (
              <Button
                key={mode}
                size="sm"
                className="text-xs"
                variant={selected === mode ? "default" : "ghost"}
                aria-pressed={selected === mode}
                disabled={props.disabled || saving}
                onClick={() => void choose(mode)}
              >
                {label}
              </Button>
            ))}
          </div>
        </div>
        {error && (
          <p role="alert" className="pt-2 text-xs text-cream-muted">
            {error}
          </p>
        )}
      </div>
    );
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Thinking: ${selected === "deep" ? "Deep thinking" : "Normal"}`}
            title="Thinking mode"
            disabled={props.disabled || saving}
            className="text-cream-muted"
          >
            <Brain className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" data-misty-layer-portal>
          <DropdownMenuRadioGroup
            value={selected}
            onValueChange={(mode) => void choose(mode as ThinkingMode)}
          >
            {options.map(({ mode, label }) => (
              <DropdownMenuRadioItem key={mode} value={mode}>
                {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {error && (
        <span role="alert" className="text-xs text-cream-muted">
          {error}
        </span>
      )}
    </>
  );
}
