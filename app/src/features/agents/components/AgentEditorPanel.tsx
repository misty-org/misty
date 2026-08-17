import { useSpacesStore } from "@/features/spaces";
import {
  Button,
  Checkbox,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@/shared/ui";
import { Trash2 } from "lucide-react";
import type { ReasoningEffort } from "../model/interfaces/personal";
import type { AgentEditorState } from "../useAgentEditor";
import { AgentEditorField as Field } from "./AgentEditorField";
import { AgentModelPicker } from "./AgentModelPicker";
import { PersonalAgentToolboxFieldset } from "./PersonalAgentToolboxFieldset";

const CONTEXT_LABELS = {
  space_chat: "Chat",
  library: "Library",
  notes: "Task notes",
  tasks: "Planner",
  members: "Members",
};

/** The Agent form, filling the right half of the Agents tab. */
export function AgentEditorPanel({ editor }: { editor: AgentEditorState }) {
  const spaces = useSpacesStore((state) => state.spaces);
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
            Configure the reusable identity and choose the Spaces where this Agent is a member.
          </p>
          <Field label="Name">
            <Input
              value={editor.name}
              maxLength={80}
              onChange={(event) => editor.setName(event.target.value)}
            />
          </Field>
          <Field label="Description">
            <Input
              value={editor.description}
              maxLength={400}
              onChange={(event) => editor.setDescription(event.target.value)}
            />
          </Field>
          <Field label="Instructions">
            <Textarea
              value={editor.instructions}
              rows={6}
              onChange={(event) => editor.setInstructions(event.target.value)}
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
          <fieldset className="grid gap-2 rounded-lg border border-charcoal-border p-3">
            <legend className="px-1 text-sm font-medium">Readable Space context</legend>
            {Object.entries(CONTEXT_LABELS).map(([key, label]) => (
              <Label className="flex items-center gap-2 font-normal" key={key}>
                <Checkbox
                  checked={editor.contextPermissions[key as keyof typeof CONTEXT_LABELS]}
                  onCheckedChange={(checked) =>
                    editor.setContextPermissions((current) => ({
                      ...current,
                      [key]: checked === true,
                    }))
                  }
                />
                {label}
              </Label>
            ))}
          </fieldset>
          <PersonalAgentToolboxFieldset
            actions={editor.toolbox.actions}
            activity={editor.toolbox.activity}
            loaded={editor.toolbox.loaded}
            onActionsChange={editor.toolbox.setActions}
            disabledSurfaces={editor.disabledSurfaces}
            onDisabledSurfacesChange={editor.setDisabledSurfaces}
          />
          <fieldset className="grid gap-3 rounded-lg border border-charcoal-border p-3">
            <legend className="px-1 text-sm font-medium">Share in Spaces</legend>
            {spaces.map((space) => {
              const grant = editor.grants[space.id] ?? {
                enabled: false,
                allMembers: true,
                memberUserIds: [],
              };
              return (
                <div className="grid gap-2" key={space.id}>
                  <Label className="flex items-center gap-2 font-normal">
                    <Checkbox
                      checked={grant.enabled}
                      onCheckedChange={(checked) =>
                        editor.setGrants((current) => ({
                          ...current,
                          [space.id]: { ...grant, enabled: checked === true },
                        }))
                      }
                    />
                    {space.name}
                  </Label>
                  {grant.enabled ? (
                    <p className="mb-0 ml-6 mt-0 text-xs text-cream-muted">
                      Visible to everyone in this Space. Invocation is controlled by each
                      member&apos;s Agents permission.
                    </p>
                  ) : null}
                </div>
              );
            })}
          </fieldset>
          {editor.error ? <p className="m-0 text-sm text-cream-bright">{editor.error}</p> : null}
        </div>
      </div>
    </section>
  );
}
