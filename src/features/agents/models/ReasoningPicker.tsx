import { runtimeAssistantApi as assistantApi } from "@/features/agents/AgentsRuntime";
import {
  thinkingMode,
  thinkingEffort,
  type MistyReasoningEffort,
  type ThinkingMode,
} from "@/features/agents/thinkingMode";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  MenuTrigger,
} from "@/shared/ui";
import { Brain } from "lucide-react";
import { useState } from "react";

const options = [
  { mode: "normal", label: "Normal" },
  { mode: "deep", label: "Deep thinking" },
] as const;

/**
 * How hard a conversation thinks. Independent of the model: changing it never
 * touches the conversation's model choice.
 */
export function ReasoningPicker(props: {
  inline?: boolean;
  /** Toolbar geometry: the brain icon alone. */
  iconOnly?: boolean;
  conversationId?: string;
  reasoningEffort?: string;
  disabled?: boolean;
  className?: string;
  onChange: (settings: { reasoningEffort: MistyReasoningEffort }) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const selected = thinkingMode(props.reasoningEffort);
  const selectedLabel = options.find((option) => option.mode === selected)!.label;
  const choose = async (mode: ThinkingMode) => {
    if (saving || props.disabled) return;
    setSaving(true);
    setError("");
    try {
      if (props.conversationId && !props.conversationId.startsWith("local-"))
        await assistantApi.updateConversationSettings(props.conversationId, {
          thinking_mode: mode,
        });
      props.onChange({ reasoningEffort: thinkingEffort(mode) });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not change thinking mode.");
    } finally {
      setSaving(false);
    }
  };
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
        <MenuTrigger
          label={props.iconOnly ? `Thinking: ${selectedLabel}` : "Thinking mode"}
          icon={<Brain aria-hidden className="size-4 shrink-0" />}
          value={props.iconOnly ? undefined : selectedLabel}
          iconOnly={props.iconOnly}
          disabled={props.disabled || saving}
          className={props.className}
        />
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
