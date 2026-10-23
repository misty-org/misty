import { personalAgentsApi, type AgentMemory } from "@/api/agents/native";
import { AgentPermissionsField } from "./AgentPermissionsField";
import { AgentSpaceField } from "./AgentSpaceField";
import { openMisty } from "@/features/misty/handoff";
import type { AgentProfile, AgentProfileInput } from "@/shared/schemas";
import { Button, Field, Input, Textarea } from "@/shared/ui";
import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { AgentAvatarPicker } from "./AgentAvatarPicker";
import { AgentMemoryList } from "./AgentMemoryList";

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
  spaceId,
  onSaved,
  onRemoved,
  onStatusChange,
  onTalk,
}: {
  profile?: AgentProfile;
  spaceId: string;
  onSaved(id: string): Promise<void>;
  onRemoved(): Promise<void>;
  onStatusChange(status: { dirty: boolean; busy: boolean }): void;
  onTalk?: () => void;
}) {
  const [draft, setDraft] = useState<AgentProfileInput>(profile ?? emptyProfile);
  const [baselineDraft, setBaselineDraft] = useState(draft);
  const profileId = profile?.id;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [memories, setMemories] = useState<AgentMemory[]>([]);
  const [editingMemory, setEditingMemory] = useState<string>();
  const [memoryDraft, setMemoryDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(baselineDraft) ||
    Boolean(
      editingMemory &&
      memoryDraft !== memories.find((memory) => memory.id === editingMemory)?.content,
    );
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
  useEffect(() => {
    let canceled = false;
    if (!profileId) return;
    void personalAgentsApi
      .memories(profileId, spaceId)
      .then((result) => {
        if (!canceled) setMemories(result.memories);
      })
      .catch((reason) => {
        if (!canceled) setError(String(reason));
      });
    return () => {
      canceled = true;
    };
  }, [profileId, spaceId]);
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
  async function talk() {
    if (!profile) return;
    if (onTalk) {
      onTalk();
      return;
    }
    try {
      await openMisty({
        spaceId,
        agentId: profile.id,
      });
    } catch (reason) {
      setError(String(reason));
    }
  }
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
      <Field label="Description">
        <Textarea
          className="min-h-20 resize-y"
          maxLength={2000}
          placeholder="What this agent helps you with"
          value={draft.description}
          onChange={(e) => update("description", e.target.value)}
        />
      </Field>
      <AgentPermissionsField
        value={draft.default_run_mode ?? "ask"}
        onChange={(mode) => update("default_run_mode", mode)}
      />
      <details className="agent-advanced-settings">
        <summary>Instructions and memory</summary>
        <div>
          <Field label="Label (optional)">
            <Input
              maxLength={160}
              placeholder="Manage launch communications"
              value={draft.role}
              onChange={(e) => update("role", e.target.value)}
            />
          </Field>
          <Field label="Instructions">
            <Textarea
              className="min-h-32 resize-y"
              maxLength={16000}
              placeholder="What should this agent know about how you work?"
              value={draft.instructions}
              onChange={(e) => update("instructions", e.target.value)}
            />
          </Field>
          {profile ? <AgentSpaceField agentId={profile.id} /> : null}
          {profile ? (
            <AgentMemoryList
              agentId={profile.id}
              spaceId={spaceId}
              memories={memories}
              setMemories={setMemories}
              editing={editingMemory}
              setEditing={setEditingMemory}
              draft={memoryDraft}
              setDraft={setMemoryDraft}
              onError={setError}
              onTalk={() => void talk()}
            />
          ) : null}
        </div>
      </details>
      {error && (
        <p role="alert" className="text-sm text-cream-muted">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-3 empty:hidden">
        {(!profile || dirty) && (
          <Button disabled={busy || !draft.name.trim()} type="submit">
            {busy ? "Saving…" : profile ? "Save changes" : "Create agent"}
          </Button>
        )}
        {profile && !profile.system_managed && (
          <Button
            variant="outline"
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
          <Button variant="outline" type="button" size="sm" onClick={() => setConfirmDelete(false)}>
            Keep agent
          </Button>{" "}
          <Button
            variant="outline"
            type="button"
            size="sm"
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
