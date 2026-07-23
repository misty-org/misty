import { ArrowUp, ChevronDown, Gauge, Plus, ShieldAlert, X } from "lucide-react";
import { Button } from "@/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/ui";
import type { AiMode } from "@/models/types/stores/assistant/useAiServerStore";
import type { GatewayModel } from "@/models/interfaces/features/agents/personal";
import { AgentModelPicker } from "@/features/agents/components/AgentModelPicker";

// Shared composer actions for full-page Agent and Space conversations.
export function AssistantComposerActions(props: {
  mode: AiMode;
  modelName: string;
  configured: boolean;
  running: boolean;
  prompt: string;
  setMode: (mode: AiMode) => void;
  abortPrompt: () => Promise<void>;
  onAddContext?: () => void;
  showAccessControls?: boolean;
  contextLabel?: string;
  modelOptions?: GatewayModel[];
  selectedModelId?: string;
  onSelectModel?: (modelId: string) => void;
  reasoningEffort?: string;
  reasoningSupported?: boolean;
  onSelectReasoning?: (effort: string) => void;
}) {
  const showAccessControls = props.showAccessControls !== false;
  return (
    <div className="relative z-10 flex h-[50px] min-w-0 items-center justify-between gap-3 px-3 pb-2">
      <div className="flex min-w-0 items-center gap-1">
        {showAccessControls ? (
          <>
            <Button
              variant="ghost"
              size="icon"
              className="size-9 rounded-full"
              title="Add files as context"
              type="button"
              aria-label="Add context"
              onClick={props.onAddContext}
            >
              <Plus size={19} />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="h-9 min-w-[124px] justify-start gap-2 px-2.5"
                  type="button"
                >
                  <ShieldAlert size={17} />
                  <span className="min-w-0 flex-1 truncate text-left">
                    {props.mode === "ask" ? "Ask first" : "Full access"}
                  </span>
                  <ChevronDown size={15} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="top" className="w-40">
                <DropdownMenuRadioGroup
                  value={props.mode === "ask" ? "ask" : "auto"}
                  onValueChange={(value) => props.setMode(value === "auto" ? "auto" : "ask")}
                >
                  <DropdownMenuRadioItem value="ask">Ask first</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="auto">Full access</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        ) : (
          <span className="px-1 text-xs text-muted-foreground">{props.contextLabel}</span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {props.onSelectReasoning && props.reasoningSupported ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="h-9 gap-1.5 px-2.5 text-sm text-muted-foreground"
                type="button"
                disabled={props.running}
                title="Reasoning effort"
              >
                <Gauge size={16} className="shrink-0" />
                <span className="capitalize">{props.reasoningEffort || "medium"}</span>
                <ChevronDown size={15} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="top" className="w-36">
              <DropdownMenuRadioGroup
                value={props.reasoningEffort || "medium"}
                onValueChange={props.onSelectReasoning}
              >
                <DropdownMenuRadioItem value="low">Low</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="medium">Medium</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="high">High</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {props.modelOptions && props.onSelectModel ? (
          <AgentModelPicker
            models={props.modelOptions}
            value={props.selectedModelId ?? ""}
            onValueChange={props.onSelectModel}
            disabled={props.running}
            side="top"
            align="end"
            className="max-w-52 text-sm text-muted-foreground"
          />
        ) : (
          <span
            className="max-w-36 truncate px-1 text-sm text-muted-foreground"
            title={props.modelName}
          >
            {props.modelName}
          </span>
        )}
        {props.running ? (
          <Button
            size="icon"
            className="size-9 rounded-full"
            type="button"
            aria-label="Stop agent"
            title="Cancel the active agent request"
            onClick={props.abortPrompt}
          >
            <X size={17} />
          </Button>
        ) : (
          <Button
            size="icon"
            className="size-9 rounded-full"
            type="submit"
            aria-label="Send to agent"
            disabled={!props.configured || !props.prompt.trim()}
          >
            <ArrowUp size={19} />
          </Button>
        )}
      </div>
    </div>
  );
}
