import { useEffect, useState, type ReactNode } from "react";
import { ChevronRight, Plus, Settings2, Trash2 } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import {
  Button,
  Checkbox,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
  cn,
} from "@/ui";
import type { PersonalAgent, ReasoningEffort } from "@/models/interfaces/features/agents/personal";
import { personalAgentsApi, usePersonalAgentsStore } from "@/stores/agents/usePersonalAgentsStore";
import { useSpacesStore } from "@/stores/spaces/useSpacesStore";
import { AgentModelPicker } from "@/features/agents/components/AgentModelPicker";
import { initialAgentModelId, modelSupportsReasoning } from "@/features/agents/modelSelection";
import { useAgentSessionStore } from "@/stores/agent/useAgentSessionStore";
import { AgentChatList } from "./AgentChatList";

const defaultContext = {
  space_chat: true,
  library: true,
  notes: true,
  tasks: true,
  members: true,
};

type GrantDraft = Record<
  string,
  { enabled: boolean; allMembers: boolean; memberUserIds: string[] }
>;

export function PersonalAgentsSidebar({
  selectedAgentId,
  onSelect,
  onNewChat,
}: {
  selectedAgentId: string;
  onSelect: (agentId: string) => void;
  onNewChat: (agentId: string) => void;
}) {
  const { agents, models, loading, load, save, remove } = usePersonalAgentsStore(
    useShallow((state) => ({
      agents: state.agents,
      models: state.models,
      loading: state.loading,
      load: state.load,
      save: state.save,
      remove: state.remove,
    })),
  );
  const spaces = useSpacesStore((state) => state.spaces);
  const membersBySpace = useSpacesStore((state) => state.membersBySpace);
  const loadMembers = useSpacesStore((state) => state.loadMembers);
  const [editing, setEditing] = useState<PersonalAgent | null | "new">(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [modelId, setModelId] = useState(initialAgentModelId);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>("");
  const [contextPermissions, setContextPermissions] = useState(defaultContext);
  const [writeAllowed, setWriteAllowed] = useState(false);
  const [grants, setGrants] = useState<GrantDraft>({});
  const [saving, setSaving] = useState(false);
  const [editorError, setEditorError] = useState("");
  const activeChatCount = useAgentSessionStore((state) => state.conversations.length);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedModel = models.find((model) => model.id === modelId);
  const selectedSupportsReasoning = modelSupportsReasoning(selectedModel?.capabilities);

  const openEditor = (agent: PersonalAgent | "new") => {
    setEditing(agent);
    setName(agent === "new" ? "" : agent.name);
    setDescription(agent === "new" ? "" : agent.description);
    setInstructions(agent === "new" ? "" : agent.instructions);
    setModelId(
      agent === "new" || agent.model_mode === "automatic" || !agent.model_id
        ? initialAgentModelId
        : agent.model_id,
    );
    setReasoningEffort(agent === "new" ? "" : (agent.reasoning_effort ?? ""));
    setContextPermissions(
      agent === "new" ? defaultContext : { ...defaultContext, ...agent.context_permissions },
    );
    setWriteAllowed(agent === "new" ? false : Boolean(agent.tool_permissions?.write));
    setGrants({});
    setEditorError("");
    if (agent !== "new") {
      void personalAgentsApi
        .grants(agent.id)
        .then(({ grants: current }) =>
          setGrants(
            Object.fromEntries(
              current.map((grant) => [
                grant.space_id,
                {
                  enabled: true,
                  allMembers: grant.all_members,
                  memberUserIds: grant.member_user_ids,
                },
              ]),
            ),
          ),
        )
        .catch((error: unknown) =>
          setEditorError(error instanceof Error ? error.message : "Sharing could not be loaded."),
        );
    }
  };

  const saveEditor = async () => {
    if (!name.trim() || !modelId || saving) return;
    setSaving(true);
    setEditorError("");
    try {
      const current = editing === "new" ? null : editing;
      const saved = await save(current?.id ?? null, {
        name: name.trim(),
        description: description.trim(),
        icon: current?.icon ?? "",
        instructions: instructions.trim(),
        model_mode: "pinned",
        model_id: modelId,
        reasoning_effort: selectedSupportsReasoning ? reasoningEffort || "medium" : "",
        context_permissions: contextPermissions,
        tool_permissions: { read: true, write: writeAllowed, integrations: [] },
        enabled: current?.enabled ?? true,
        version: current?.version,
      });
      await personalAgentsApi.replaceGrants(
        saved.id,
        Object.entries(grants).flatMap(([spaceId, grant]) =>
          grant.enabled
            ? [
                {
                  space_id: spaceId,
                  all_members: grant.allMembers,
                  member_user_ids: grant.allMembers ? [] : grant.memberUserIds,
                },
              ]
            : [],
        ),
      );
      setEditing(null);
      onSelect(saved.id);
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : "The Agent could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="Agents">
      <div className="flex shrink-0 items-center justify-between gap-2 px-2 pb-3">
        <h2 className="m-0 text-sm font-semibold text-muted-foreground">Agents</h2>
        <Button size="icon" variant="ghost" className="size-8" onClick={() => openEditor("new")}>
          <Plus size={14} />
          <span className="sr-only">Create Agent</span>
        </Button>
      </div>
      <nav className="misty-transient-scrollbar grid min-h-0 flex-1 content-start gap-1 overflow-y-auto">
        {agents.map((agent) => {
          const expanded = agent.id === selectedAgentId;
          return (
            <section key={agent.id} className="grid min-w-0 gap-1">
              <ContextMenu>
                <ContextMenuTrigger asChild>
                  <div className="group/agent flex min-h-7 min-w-0 items-center gap-1 px-2">
                    <button
                      type="button"
                      aria-expanded={expanded}
                      className={cn(
                        "flex min-w-0 flex-1 items-center gap-1.5 rounded-md text-left text-xs font-semibold outline-none",
                        expanded
                          ? "text-sidebar-accent-foreground"
                          : "text-muted-foreground hover:text-sidebar-accent-foreground",
                      )}
                      onClick={() => onSelect(agent.id)}
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {agent.name}
                        {expanded && activeChatCount > 0 ? (
                          <span className="text-muted-foreground/80"> - {activeChatCount}</span>
                        ) : null}
                      </span>
                      <ChevronRight
                        size={13}
                        className={cn(
                          "ml-auto shrink-0 transition-transform",
                          expanded && "rotate-90",
                        )}
                      />
                    </button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-6 shrink-0 opacity-0 shadow-none group-hover/agent:opacity-100 focus-visible:opacity-100"
                      onClick={() => openEditor(agent)}
                    >
                      <Settings2 size={13} />
                      <span className="sr-only">Agent preferences for {agent.name}</span>
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-6 shrink-0 opacity-0 shadow-none group-hover/agent:opacity-100 focus-visible:opacity-100"
                      onClick={() => onNewChat(agent.id)}
                    >
                      <Plus size={13} />
                      <span className="sr-only">New chat with {agent.name}</span>
                    </Button>
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem onSelect={() => onNewChat(agent.id)}>
                    <Plus size={14} /> New chat
                  </ContextMenuItem>
                  <ContextMenuItem onSelect={() => openEditor(agent)}>
                    <Settings2 size={14} /> Preferences…
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    className="text-destructive focus:text-destructive"
                    onSelect={() =>
                      void remove(agent.id).then(() => {
                        if (selectedAgentId === agent.id) onSelect("");
                      })
                    }
                  >
                    <Trash2 size={14} /> Delete
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
              {expanded ? <AgentChatList /> : null}
            </section>
          );
        })}
        {!loading && agents.length === 0 ? (
          <p className="px-2.5 py-3 text-xs text-muted-foreground">
            Create an Agent for repeat work.
          </p>
        ) : null}
      </nav>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[88vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing === "new" ? "Create Agent" : "Edit Agent"}</DialogTitle>
            <DialogDescription>
              Personal by default. Share invocation access without exposing instructions or memory.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <Field label="Name">
              <Input
                value={name}
                maxLength={80}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Field label="Description">
              <Input
                value={description}
                maxLength={400}
                onChange={(event) => setDescription(event.target.value)}
              />
            </Field>
            <Field label="Instructions">
              <Textarea
                value={instructions}
                rows={6}
                onChange={(event) => setInstructions(event.target.value)}
              />
            </Field>
            <Field label="Model">
              <AgentModelPicker
                models={models}
                value={modelId}
                onValueChange={setModelId}
                className="w-full border border-input bg-background"
              />
            </Field>
            <Field label="Reasoning effort">
              <Select
                value={reasoningEffort || "medium"}
                onValueChange={(value) => setReasoningEffort(value as ReasoningEffort)}
                disabled={!selectedSupportsReasoning}
              >
                <SelectTrigger className="w-full border border-input bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                </SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground">
                {selectedSupportsReasoning
                  ? "Higher effort means deeper reasoning and slower, costlier replies."
                  : "This model doesn't support adjustable reasoning. Pick a reasoning model to enable it."}
              </span>
            </Field>
            <fieldset className="grid gap-2 rounded-lg border border-border p-3">
              <legend className="px-1 text-sm font-medium">Readable Space context</legend>
              {Object.entries({
                space_chat: "Chat",
                library: "Library",
                notes: "Notes",
                tasks: "Tasks",
                members: "Members",
              }).map(([key, label]) => (
                <Label className="flex items-center gap-2 font-normal" key={key}>
                  <Checkbox
                    checked={contextPermissions[key as keyof typeof contextPermissions]}
                    onCheckedChange={(checked) =>
                      setContextPermissions((current) => ({ ...current, [key]: checked === true }))
                    }
                  />
                  {label}
                </Label>
              ))}
            </fieldset>
            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div>
                <p className="m-0 text-sm font-medium">Allow write tools</p>
                <p className="m-0 text-xs text-muted-foreground">
                  Risky actions still require approval.
                </p>
              </div>
              <Switch checked={writeAllowed} onCheckedChange={setWriteAllowed} />
            </div>
            <fieldset className="grid gap-3 rounded-lg border border-border p-3">
              <legend className="px-1 text-sm font-medium">Share in Spaces</legend>
              {spaces.map((space) => {
                const grant = grants[space.id] ?? {
                  enabled: false,
                  allMembers: true,
                  memberUserIds: [],
                };
                const members = membersBySpace[space.id] ?? [];
                return (
                  <div className="grid gap-2" key={space.id}>
                    <Label className="flex items-center gap-2 font-normal">
                      <Checkbox
                        checked={grant.enabled}
                        onCheckedChange={(checked) => {
                          const enabled = checked === true;
                          setGrants((current) => ({
                            ...current,
                            [space.id]: { ...grant, enabled },
                          }));
                          if (enabled) void loadMembers(space.id);
                        }}
                      />
                      {space.name}
                    </Label>
                    {grant.enabled ? (
                      <div className="ml-6 grid gap-2">
                        <Select
                          value={grant.allMembers ? "all" : "selected"}
                          onValueChange={(value) =>
                            setGrants((current) => ({
                              ...current,
                              [space.id]: { ...grant, allMembers: value === "all" },
                            }))
                          }
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">Everyone in this Space</SelectItem>
                            <SelectItem value="selected">Selected members</SelectItem>
                          </SelectContent>
                        </Select>
                        {!grant.allMembers
                          ? members.map((member) => (
                              <Label
                                key={member.user_id}
                                className="flex items-center gap-2 text-xs font-normal"
                              >
                                <Checkbox
                                  checked={grant.memberUserIds.includes(member.user_id)}
                                  onCheckedChange={(checked) =>
                                    setGrants((current) => ({
                                      ...current,
                                      [space.id]: {
                                        ...grant,
                                        memberUserIds:
                                          checked === true
                                            ? [...new Set([...grant.memberUserIds, member.user_id])]
                                            : grant.memberUserIds.filter(
                                                (id) => id !== member.user_id,
                                              ),
                                      },
                                    }))
                                  }
                                />
                                {member.name}
                              </Label>
                            ))
                          : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </fieldset>
            {editorError ? <p className="m-0 text-sm text-destructive">{editorError}</p> : null}
          </div>
          <DialogFooter className="justify-between sm:justify-between">
            {editing !== "new" && editing ? (
              <Button
                variant="destructive"
                type="button"
                onClick={() =>
                  void remove(editing.id).then(() => {
                    setEditing(null);
                    if (selectedAgentId === editing.id) onSelect("");
                  })
                }
              >
                <Trash2 size={14} /> Delete
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button
                disabled={!name.trim() || !modelId || saving}
                onClick={() => void saveEditor()}
              >
                {saving ? "Saving…" : "Save Agent"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Label className="grid gap-1.5">
      <span>{label}</span>
      {children}
    </Label>
  );
}
