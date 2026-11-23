import { personalAgentsApi } from "./personal_agents_api";
import { AgentPermissionsField } from "./AgentPermissionsField";
import { AgentEngineField } from "../engines/AgentEngineField";
import type { AgentProfile, AgentProfileInput } from "@/shared/schemas";
import { Button, useNotice, Field, Input, Text, Textarea } from "@misty/ui";
import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { AgentAvatarPicker } from "./AgentAvatarPicker";
import { AgentBotFields, ExportBotButton } from "../bots/AgentBotFields";
import { AgentSpaceField, CopyAgentToSpace, useAgentHomeSpace } from "./AgentSpaceField";
import { AgentVoicePicker } from "./AgentVoicePicker";

const emptyProfile: AgentProfileInput = {
  name: "",
  role: "",
  description: "",
  instructions: "",
  icon: "",
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
  const home = useAgentHomeSpace(profile);
  const readOnly = profile?.can_edit === false;
  const sharedSpace = home?.space && !home.personal ? home.space.name : "";
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
        voice,
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
          voice,
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
      className="grid gap-5 p-1"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <fieldset disabled={readOnly} className="contents">
        <span data-tour="agent-avatar" className="contents">
          <AgentAvatarPicker
            profile={profile}
            name={draft.name}
            avatar={draft.avatar}
            busy={busy || readOnly}
            onChange={(avatar) => update("avatar", avatar)}
          />
        </span>
        <Field label="Name">
          <Input
            required
            maxLength={80}
            value={draft.name}
            readOnly={profile?.system_managed || readOnly}
            onChange={(e) => update("name", e.target.value)}
          />
        </Field>
        {profile?.system_managed ? null : (
          <Field label="Voice">
            <AgentVoicePicker
              name={draft.name}
              voice={draft.voice}
              disabled={busy || readOnly}
              onChange={(voice) => update("voice", voice)}
            />
          </Field>
        )}
        <span data-tour="agent-role" className="contents">
          <Field label="Role">
            <Input
              maxLength={160}
              placeholder="Reviews pull requests"
              value={draft.role}
              readOnly={readOnly}
              onChange={(e) => update("role", e.target.value)}
            />
          </Field>
        </span>
        <Field label="Description">
          <Textarea
            className="min-h-20 resize-y"
            maxLength={2000}
            placeholder="What this agent helps you with"
            value={draft.description}
            readOnly={readOnly}
            onChange={(e) => update("description", e.target.value)}
          />
        </Field>
        <span data-tour="agent-engine" className="contents">
          <AgentEngineField
            engine={draft.engine ?? ""}
            model={draft.engine_model ?? ""}
            locked={profile?.system_managed || readOnly}
            onEngine={(engine) => update("engine", engine)}
            onModel={(model) => update("engine_model", model)}
          />
        </span>
      </fieldset>
      {profile ? <AgentSpaceField agent={profile} /> : null}
      {profile ? <CopyAgentToSpace agent={profile} /> : null}
      <span data-tour="agent-permissions" className="contents">
        <AgentPermissionsField
          engine={draft.engine}
          value={draft.default_run_mode ?? "ask"}
          onChange={(mode) => update("default_run_mode", mode)}
        />
      </span>
      <details className="py-1" data-tour="agent-instructions">
        <Text as="summary" bare size="control" tone="muted" className="cursor-pointer">
          Soul and instructions
        </Text>
        <div className="grid gap-4 pt-4">
          <Field label="Instructions">
            <Textarea
              className="min-h-32 resize-y"
              maxLength={16000}
              placeholder="What should this agent know about how you work?"
              value={draft.instructions}
              disabled={readOnly}
              onChange={(e) => update("instructions", e.target.value)}
            />
          </Field>
          <AgentBotFields draft={draft} onChange={update} soulLocked={readOnly} />
        </div>
      </details>
      <div className="flex flex-wrap gap-3 empty:hidden">
        {(!profile || dirty) && (
          <Button disabled={!draft.name.trim() || (!profile && !draft.voice) || busy} type="submit">
            {profile ? "Save changes" : "Create agent"}
          </Button>
        )}
        {profile && !dirty ? <ExportBotButton agent={profile} /> : null}
        {profile && !profile.system_managed && !readOnly && (
          <Button
            type="button"
            className="ml-auto"
            disabled={busy}
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 className="mr-1 inline" />
            Delete agent
          </Button>
        )}
      </div>
      {confirmDelete && (
        <div role="alert" className="space-y-3 text-control">
          <p>
            {sharedSpace
              ? `Delete ${profile?.name}? It leaves ${sharedSpace} for everyone there, and active work will stop. Existing conversation history is retained.`
              : `Delete ${profile?.name}? Active work will stop. Existing conversation history is retained.`}
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
