import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import type { PersonalAgent, ReasoningEffort } from "./model/interfaces/personal";
import { initialAgentModelId, modelSupportsReasoning } from "./modelSelection";
import { personalAgentsApi, usePersonalAgentsStore } from "./store/usePersonalAgentsStore";
import { usePersonalAgentToolbox } from "./usePersonalAgentToolbox";

export const defaultAgentContext = {
  space_chat: true,
  library: true,
  notes: true,
  tasks: true,
  members: true,
};

export type AgentGrantDraft = Record<
  string,
  { enabled: boolean; allMembers: boolean; memberUserIds: string[] }
>;

/**
 * The editor for one Agent, held by the page so the form can live in the right
 * panel next to the list instead of in a dialog over it. `editing` doubles as
 * the panel's route: null shows the placeholder, "new" an empty draft.
 */
export function useAgentEditor() {
  const { models, save, remove } = usePersonalAgentsStore(
    useShallow((state) => ({
      models: state.models,
      save: state.save,
      remove: state.remove,
    })),
  );
  const [editing, setEditing] = useState<PersonalAgent | null | "new">(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [modelId, setModelId] = useState(initialAgentModelId);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>("");
  const [contextPermissions, setContextPermissions] = useState(defaultAgentContext);
  const [grants, setGrants] = useState<AgentGrantDraft>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const toolbox = usePersonalAgentToolbox();

  const selectedModel = models.find((model) => model.id === modelId);
  const supportsReasoning = modelSupportsReasoning(selectedModel?.capabilities);
  const editingAgentId = editing && editing !== "new" ? editing.id : "";

  const open = (agent: PersonalAgent | "new") => {
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
      agent === "new"
        ? defaultAgentContext
        : { ...defaultAgentContext, ...agent.context_permissions },
    );
    setGrants({});
    setError("");
    toolbox.load(agent === "new" ? null : agent.id, setError);
    if (agent === "new") return;
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
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : "Sharing could not be loaded."),
      );
  };

  const close = () => setEditing(null);

  const submit = async () => {
    if (!name.trim() || !modelId || saving) return;
    setSaving(true);
    setError("");
    try {
      const current = editing === "new" ? null : editing;
      const selectedToolGrants = toolbox.actions
        .filter((action) => action.granted)
        .map((action) => ({ capability: action.name, risk: action.risk }));
      const toolPermissions = toolbox.loaded
        ? {
            read: selectedToolGrants.some((grant) => grant.risk === "read"),
            write: selectedToolGrants.some((grant) => grant.risk !== "read"),
            integrations: current?.tool_permissions.integrations ?? [],
            grants: selectedToolGrants,
          }
        : (current?.tool_permissions ?? { read: true, write: false, integrations: [] });
      const saved = await save(current?.id ?? null, {
        name: name.trim(),
        description: description.trim(),
        icon: current?.icon ?? "",
        instructions: instructions.trim(),
        model_mode: "pinned",
        model_id: modelId,
        reasoning_effort: supportsReasoning ? reasoningEffort || "medium" : "",
        context_permissions: contextPermissions,
        tool_permissions: toolPermissions,
        enabled: current?.enabled ?? true,
        version: current?.version,
      });
      await personalAgentsApi.replaceGrants(
        saved.id,
        Object.entries(grants).flatMap(([spaceId, grant]) =>
          grant.enabled ? [{ space_id: spaceId, all_members: true, member_user_ids: [] }] : [],
        ),
      );
      // Stay on the saved Agent so the panel keeps showing what was just edited.
      setEditing(saved);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The Agent could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const deleteAgent = async (agentId: string) => {
    await remove(agentId);
    if (editingAgentId === agentId) setEditing(null);
  };

  return {
    editing,
    editingAgentId,
    models,
    name,
    setName,
    description,
    setDescription,
    instructions,
    setInstructions,
    modelId,
    setModelId,
    reasoningEffort,
    setReasoningEffort,
    contextPermissions,
    setContextPermissions,
    grants,
    setGrants,
    saving,
    error,
    supportsReasoning,
    toolbox,
    open,
    close,
    submit,
    deleteAgent,
  };
}

export type AgentEditorState = ReturnType<typeof useAgentEditor>;
