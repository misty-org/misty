import type { ReactNode } from "react";
import {
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@/ui";
import type { GatewayModel, ReasoningEffort } from "@/models/interfaces/features/agents/personal";
import { AgentModelPicker } from "./components/AgentModelPicker";

export function AgentCreatorBehaviorStep({
  personality,
  communicationStyle,
  instructions,
  models,
  modelId,
  reasoning,
  supportsReasoning,
  onPersonalityChange,
  onCommunicationStyleChange,
  onInstructionsChange,
  onModelChange,
  onReasoningChange,
}: {
  personality: string;
  communicationStyle: string;
  instructions: string;
  models: GatewayModel[];
  modelId: string;
  reasoning: ReasoningEffort;
  supportsReasoning: boolean;
  onPersonalityChange: (value: string) => void;
  onCommunicationStyleChange: (value: string) => void;
  onInstructionsChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onReasoningChange: (value: ReasoningEffort) => void;
}) {
  return (
    <>
      <WizardField label="Personality" hint="The teammate's consistent professional temperament.">
        <Select value={personality} onValueChange={onPersonalityChange}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="thoughtful">Thoughtful</SelectItem>
            <SelectItem value="direct">Direct</SelectItem>
            <SelectItem value="encouraging">Encouraging</SelectItem>
            <SelectItem value="analytical">Analytical</SelectItem>
          </SelectContent>
        </Select>
      </WizardField>
      <WizardField label="Communication style" hint="How this teammate should present its work.">
        <Select value={communicationStyle} onValueChange={onCommunicationStyleChange}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="concise">Concise</SelectItem>
            <SelectItem value="conversational">Conversational</SelectItem>
            <SelectItem value="detailed">Detailed</SelectItem>
            <SelectItem value="executive summaries first">Executive summaries first</SelectItem>
          </SelectContent>
        </Select>
      </WizardField>
      <WizardField
        label="Instructions"
        hint="Private operating guidance. Space managers cannot read this."
      >
        <Textarea
          value={instructions}
          rows={8}
          placeholder="Be concise, surface risks early, and ask before making high-impact changes…"
          onChange={(event) => onInstructionsChange(event.target.value)}
        />
      </WizardField>
      <WizardField label="Model">
        <AgentModelPicker
          models={models}
          value={modelId}
          onValueChange={onModelChange}
          className="w-full border border-charcoal-border bg-charcoal-bg"
        />
      </WizardField>
      <WizardField
        label="Reasoning effort"
        hint={
          supportsReasoning
            ? "Higher effort is slower and more thorough."
            : "The selected model does not expose reasoning controls."
        }
      >
        <Select
          value={reasoning}
          onValueChange={(value) => onReasoningChange(value as ReasoningEffort)}
          disabled={!supportsReasoning}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="low">Low</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="high">High</SelectItem>
          </SelectContent>
        </Select>
      </WizardField>
    </>
  );
}

function WizardField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <div>
        <Label className="font-medium">{label}</Label>
        {hint ? <p className="mb-0 mt-0.5 text-xs text-cream-muted">{hint}</p> : null}
      </div>
      {children}
    </div>
  );
}
