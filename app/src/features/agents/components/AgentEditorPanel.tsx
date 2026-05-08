import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@/shared/ui";
import { Trash2 } from "lucide-react";
import type { AgentRunMode, ReasoningEffort } from "../model/interfaces/personal";
import type { AgentEditorState } from "../useAgentEditor";
import { AgentEditorField as Field } from "./AgentEditorField";
import { AgentModelPicker } from "./AgentModelPicker";

/** The Agent form, filling the right half of the Agents tab. */
export function AgentEditorPanel({ editor }: { editor: AgentEditorState }) {
  const isNew = editor.editing === "new";

  return (
    <section className="flex min-h-0 flex-col" aria-label="Agent preferences">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-charcoal-border px-4">
        <h1 className="m-0 min-w-0 flex-1 truncate text-[13px] font-semibold leading-tight">
          {isNew ? "Create Agent" : editor.name || "Agent"}
        </h1>
        {!isNew && editor.editingAgentId ? (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-8 text-cream-muted hover:text-cream-bright"
            aria-label={`Delete ${editor.name || "Agent"}`}
            onClick={() => void editor.deleteAgent(editor.editingAgentId)}
          >
            <Trash2 size={15} />
          </Button>
        ) : null}
        <Button type="button" variant="outline" size="sm" onClick={editor.close}>
          {isNew ? "Discard" : "Close"}
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={!editor.name.trim() || !editor.modelId || editor.saving}
          onClick={() => void editor.submit()}
        >
          {editor.saving ? "Saving…" : "Save Agent"}
        </Button>
      </header>

      <div className="misty-transient-scrollbar min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-2xl gap-4 px-6 py-5">
          <p className="m-0 text-sm text-cream-muted">
            Give this Agent a name and describe how it should help.
          </p>
          <Field label="Name">
            <Input
              value={editor.name}
              maxLength={80}
              onChange={(event) => editor.setName(event.target.value)}
            />
          </Field>
          <Field label="Avatar (optional)">
            <Input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={(event) => editor.setAvatarFile(event.target.files?.[0] ?? null)}
            />
          </Field>
          <Field label="What should this Agent help with?">
            <Textarea
              value={editor.instructions}
              rows={6}
              onChange={(event) => editor.setInstructions(event.target.value)}
            />
          </Field>
          <details className="rounded-xl border border-charcoal-border bg-charcoal-card p-4">
            <summary className="cursor-pointer text-sm font-medium text-cream">
              Advanced preferences
            </summary>
            <div className="mt-4 grid gap-4">
              <Field label="Description">
                <Input
                  value={editor.description}
                  maxLength={400}
                  onChange={(event) => editor.setDescription(event.target.value)}
                />
              </Field>
              <Field label="Model">
                <AgentModelPicker
                  models={editor.models}
                  value={editor.modelId}
                  onValueChange={editor.setModelId}
                  className="w-full border border-charcoal-border bg-charcoal-bg"
                />
              </Field>
              <Field label="Reasoning effort">
                <Select
                  value={editor.reasoningEffort || "medium"}
                  onValueChange={(value) => editor.setReasoningEffort(value as ReasoningEffort)}
                  disabled={!editor.supportsReasoning}
                >
                  <SelectTrigger className="w-full border border-charcoal-border bg-charcoal-bg">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                  </SelectContent>
                </Select>
                <span className="text-xs text-cream-muted">
                  {editor.supportsReasoning
                    ? "Higher effort means deeper reasoning and slower, costlier replies."
                    : "This model doesn't support adjustable reasoning. Pick a reasoning model to enable it."}
                </span>
              </Field>
              <Field label="Default run mode">
                <Select
                  value={editor.defaultRunMode}
                  onValueChange={(value) => editor.setDefaultRunMode(value as AgentRunMode)}
                >
                  <SelectTrigger className="w-full border border-charcoal-border bg-charcoal-bg">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ask">Ask for approval</SelectItem>
                    <SelectItem value="auto">Approve routine work</SelectItem>
                    <SelectItem value="full">Full access</SelectItem>
                  </SelectContent>
                </Select>
                <span className="text-xs text-cream-muted">
                  Dangerous actions always ask, including deletion, pushes, credentials, and member
                  changes.
                </span>
              </Field>
              <Field label="Voice">
                <Select value={editor.voiceId} onValueChange={editor.setVoiceId}>
                  <SelectTrigger className="w-full border border-charcoal-border bg-charcoal-bg">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="alloy">Alloy</SelectItem>
                    <SelectItem value="coral">Coral</SelectItem>
                    <SelectItem value="nova">Nova</SelectItem>
                    <SelectItem value="sage">Sage</SelectItem>
                    <SelectItem value="verse">Verse</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
          </details>
          {editor.error ? <p className="m-0 text-sm text-cream-bright">{editor.error}</p> : null}
        </div>
      </div>
    </section>
  );
}
