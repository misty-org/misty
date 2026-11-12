import { personalAgentsApi } from "./personalAgentsApi";
import { AgentPermissionsField } from "./AgentPermissionsField";
import { AgentEngineField } from "../engines/AgentEngineField";
import type { AgentProfile, AgentProfileInput } from "@/shared/schemas";
import { Button, useNotice, Field, Input, Textarea } from "@/shared/ui";
import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { AgentAvatarPicker } from "./AgentAvatarPicker";
import { AgentBotFields, ExportBotButton } from "../bots/AgentBotFields";

const emptyProfile: AgentProfileInput = {
  name: "",
  role: "",
  description: "",
  instructions: "",
  icon: "sparkles",
  avatar: { cloudVariant: "lavender" },
  model_mode: "automatic",
  model_id: "",
  reasoning_effort: "",
  enabled: true,
  default_run_mode: "ask",
};

export function AgentEditor({
  profile,
  onSaved,
  onRemoved,
  onStatusChange,
}: {
  profile?: AgentProfile;
  onSaved(id: string): Promise<void>;
  onRemoved(): Promise<void>;
  onStatusChange(status: { dirty: boolean; busy: boolean }): void;
}) {
  const [draft, setDraft] = useState<AgentProfileInput>(profile ?? emptyProfile);
  const [baselineDraft, setBaselineDraft] = useState(draft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(baselineDraft);
  useEffect(() => {
    onStatusChange({
      dirty,
      busy,
    });
    return () =>
      onStatusChange({
        dirty: false,
        busy: false,
      });
  }, [dirty, busy, onStatusChange]);
  const update = <K extends keyof AgentProfileInput>(key: K, value: AgentProfileInput[K]) =>
    setDraft({
      ...draft,
      [key]: value,
    });
  async function save() {
    setBusy(true);
    setError("");
    try {
      const {
        name,
        role,
        description,
        instructions,
        icon,
        avatar,
        model_mode,
        model_id,
        reasoning_effort,
        enabled,
        default_run_mode,
        engine,
        engine_model,
        soul,
        tools,
        mcp_servers,
        skills,
        runtime_cwd,
        runtime_args,
        origin,
      } = draft;
      const saved = await personalAgentsApi.save(
        {
          name,
          role,
          description,
          instructions,
          icon,
          avatar,
          model_mode,
          model_id,
          reasoning_effort,
          enabled,
          default_run_mode,
          engine,
          engine_model,
          soul,
          tools,
          mcp_servers,
          skills,
          runtime_cwd,
          runtime_args,
          origin,
          version: profile?.version,
        },
        profile?.id,
      );
      await onSaved(saved.id);
      setBaselineDraft(draft);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }
  useNotice(Boolean(error), { message: error, tone: "error", onDismiss: () => setError("") });
  return (
    <form
      className="agent-profile-form"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <AgentAvatarPicker
        profile={profile}
        name={draft.name}
        avatar={draft.avatar}
        busy={busy}
        onChange={(avatar) => update("avatar", avatar)}
      />
      <Field label="Name">
        <Input
          required
          maxLength={80}
          value={draft.name}
          readOnly={profile?.system_managed}
          onChange={(e) => update("name", e.target.value)}
        />
      </Field>
      {/* What it does, in a few words: the studio and the @ menu tell agents apart by it. */}
      <Field label="Role">
        <Input
          maxLength={160}
          placeholder="Reviews pull requests"
          value={draft.role}
          onChange={(e) => update("role", e.target.value)}
        />
      </Field>
      <Field label="Description">
        <Textarea
          className="min-h-20 resize-y"
          maxLength={2000}
          placeholder="What this agent helps you with"
          value={draft.description}
          onChange={(e) => update("description", e.target.value)}
        />
      </Field>
      <AgentEngineField
        engine={draft.engine ?? ""}
        model={draft.engine_model ?? ""}
        locked={profile?.system_managed}
        onEngine={(engine) => update("engine", engine)}
        onModel={(model) => update("engine_model", model)}
      />
      <AgentPermissionsField
        value={draft.default_run_mode ?? "ask"}
        onChange={(mode) => update("default_run_mode", mode)}
      />
      <details className="agent-advanced-settings">
        <summary>Soul and instructions</summary>
        <div>
          <Field label="Instructions">
            <Textarea
              className="min-h-32 resize-y"
              maxLength={16000}
              placeholder="What should this agent know about how you work?"
              value={draft.instructions}
              onChange={(e) => update("instructions", e.target.value)}
            />
          </Field>
          <AgentBotFields draft={draft} onChange={update} />
        </div>
      </details>
      <div className="flex flex-wrap gap-3 empty:hidden">
        {(!profile || dirty) && (
          <Button disabled={busy || !draft.name.trim()} type="submit">
            {busy ? "Saving…" : profile ? "Save changes" : "Create agent"}
          </Button>
        )}
        {profile && !dirty ? <ExportBotButton agent={profile} /> : null}
        {profile && !profile.system_managed && (
          <Button
            type="button"
            className="ml-auto"
            disabled={busy}
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 size={15} className="mr-1 inline" />
            Delete agent
          </Button>
        )}
      </div>
      {confirmDelete && (
        <div role="alert" className="space-y-3 text-sm">
          <p>
            Delete {profile?.name}? Active work will stop. Existing conversation history is
            retained.
          </p>
          <Button type="button" onClick={() => setConfirmDelete(false)}>
            Keep agent
          </Button>{" "}
          <Button
            type="button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void personalAgentsApi
                .remove(profile!.id)
                .then(onRemoved)
                .catch((reason) => setError(String(reason)))
                .finally(() => setBusy(false));
            }}
          >
            Delete agent
          </Button>
        </div>
      )}
    </form>
  );
}
