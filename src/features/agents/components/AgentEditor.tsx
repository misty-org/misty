import { personalAgentsApi, type AgentMemory } from "@/api/agents/native";
import { openMisty } from "@/features/misty/handoff";
import type { AgentProfile, AgentProfileInput } from "@/shared/schemas";
import { Button, Field, Input, Pressable, Textarea, Toggle } from "@/shared/ui";
import { Pencil, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { AgentAvatar, AgentCloudImage } from "./AgentAvatar";
import { agentCloudAvatar, agentCloudVariants } from "./agentCloudAvatars";

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
  const [avatarEditing, setAvatarEditing] = useState(false);
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
      <div className="agent-profile-avatar-row">
        <Pressable
          aria-label="Edit agent avatar"
          onClick={() => setAvatarEditing(!avatarEditing)}
          className="agent-profile-avatar group relative shrink-0 overflow-hidden rounded-md"
        >
          <AgentAvatar
            agent={
              {
                ...profile,
                name: draft.name || "Agent",
                avatar: draft.avatar,
              } as AgentProfile
            }
          />
          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity rounded-xl">
            <Pencil className="size-3.5 text-cream-bright" />
          </div>
        </Pressable>
        <div className="flex-1 min-w-0">
          <Button
            variant="ghost"
            type="button"
            size="sm"
            className="h-auto p-0 text-sm"
            onClick={() => setAvatarEditing(!avatarEditing)}
          >
            {avatarEditing ? "Hide avatar options" : "Change avatar"}
          </Button>
        </div>
      </div>
      {avatarEditing && (
        <div className="rounded-xl border border-charcoal-border/70 bg-charcoal-bg/50 p-4 space-y-4">
          <div>
            <div className="text-xs font-medium text-cream-muted mb-2">Cloud avatar</div>
            <div className="grid grid-cols-2 gap-2">
              {agentCloudVariants.map((variant) => {
                const chosen =
                  !draft.avatar?.emoji &&
                  agentCloudAvatar({
                    id: profile?.id ?? "",
                    name: draft.name,
                    avatar: draft.avatar,
                    system_managed: profile?.system_managed ?? false,
                  }).id === variant.id;
                return (
                  <Toggle
                    key={variant.id}
                    variant="outline"
                    aria-label={`${variant.name}, ${variant.expression}`}
                    pressed={chosen}
                    disabled={busy}
                    onPressedChange={() =>
                      update("avatar", {
                        ...draft.avatar,
                        emoji: "",
                        cloudVariant: variant.id,
                      })
                    }
                    className="h-auto flex-col gap-1 whitespace-normal rounded-lg p-2.5 text-center text-cream-muted data-[state=on]:border-cream-bright/80"
                  >
                    <div className="size-14 shrink-0 flex items-center justify-center">
                      <AgentCloudImage variant={variant} />
                    </div>
                    <span className="text-xs font-medium text-cream leading-none">
                      {variant.name}
                    </span>
                    <span className="text-[13px] text-cream-muted leading-tight">
                      {variant.expression}
                    </span>
                  </Toggle>
                );
              })}
            </div>
          </div>
          <div className="flex items-center gap-3 pt-2 border-t border-charcoal-border/60">
            <label
              htmlFor="agent-custom-emoji"
              className="text-xs font-medium text-cream-muted shrink-0"
            >
              Custom emoji
            </label>
            <Input
              id="agent-custom-emoji"
              className="w-24 text-center text-base"
              aria-label="Avatar emoji"
              maxLength={12}
              value={typeof draft.avatar?.emoji === "string" ? draft.avatar.emoji : ""}
              placeholder="Optional"
              disabled={busy}
              onChange={(e) =>
                update("avatar", {
                  ...draft.avatar,
                  emoji: e.target.value,
                })
              }
            />
            <span className="text-xs text-cream-muted/70">Replaces cloud avatar when set</span>
          </div>
        </div>
      )}
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
          {!!memories.length && (
            <section className="border-t border-charcoal-border pt-5">
              <h3 className="mb-2 text-sm font-medium">Remembered preferences</h3>
              {memories.map((memory) => (
                <div key={memory.id} className="flex items-start gap-3 py-2 text-sm">
                  <div className="flex-1">
                    {editingMemory === memory.id ? (
                      <label className="block">
                        <span className="sr-only">Preference</span>
                        <Textarea
                          maxLength={1000}
                          value={memoryDraft}
                          onChange={(e) => setMemoryDraft(e.target.value)}
                        />
                        <div className="mt-2 flex gap-2">
                          <Button
                            variant="outline"
                            type="button"
                            size="sm"
                            disabled={!memoryDraft.trim()}
                            onClick={() => {
                              void personalAgentsApi
                                .updateMemory(profile!.id, memory.id, spaceId, memoryDraft)
                                .then(() => {
                                  setMemories((items) =>
                                    items.map((item) =>
                                      item.id === memory.id
                                        ? {
                                            ...item,
                                            content: memoryDraft,
                                          }
                                        : item,
                                    ),
                                  );
                                  setEditingMemory(undefined);
                                })
                                .catch((reason) => setError(String(reason)));
                            }}
                          >
                            Save preference
                          </Button>
                          <Button
                            variant="outline"
                            type="button"
                            size="sm"
                            onClick={() => setEditingMemory(undefined)}
                          >
                            Cancel
                          </Button>
                        </div>
                      </label>
                    ) : (
                      memory.content
                    )}
                    <span className="mt-1 block text-xs text-cream-muted">
                      {memory.space_id ? "Saved conversation scope" : "Personal"}
                    </span>
                  </div>
                  <Button
                    variant="outline"
                    type="button"
                    size="sm"
                    onClick={() => {
                      setEditingMemory(memory.id);
                      setMemoryDraft(memory.content);
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    type="button"
                    size="sm"
                    onClick={() => {
                      void personalAgentsApi
                        .forget(profile!.id, memory.id)
                        .then(() =>
                          setMemories((items) => items.filter((item) => item.id !== memory.id)),
                        )
                        .catch((reason) => setError(String(reason)));
                    }}
                  >
                    Forget
                  </Button>
                </div>
              ))}
              <Button
                variant="ghost"
                type="button"
                className="text-sm underline"
                onClick={() => void talk()}
              >
                Ask this agent to change a preference
              </Button>
            </section>
          )}
        </div>
      </details>
      {error && (
        <p role="alert" className="text-sm text-red-300">
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
