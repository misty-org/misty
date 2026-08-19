import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import type { AgentRunMode, PersonalAgent, ReasoningEffort } from "./model/interfaces/personal";
import { initialAgentModelId, modelSupportsReasoning } from "./modelSelection";
import { personalAgentsApi, usePersonalAgentsStore } from "./store/usePersonalAgentsStore";

export function useAgentEditor() {
  const { models, save, remove, load } = usePersonalAgentsStore(
    useShallow((state) => ({
      models: state.models,
      save: state.save,
      remove: state.remove,
      load: state.load,
    })),
  );
  const [editing, setEditing] = useState<PersonalAgent | null | "new">(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [modelId, setModelId] = useState(initialAgentModelId);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>("");
  const [defaultRunMode, setDefaultRunMode] = useState<AgentRunMode>("auto");
  const [voiceId, setVoiceId] = useState("alloy");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const selectedModel = models.find((model) => model.id === modelId);
  const supportsReasoning = modelSupportsReasoning(selectedModel?.capabilities);
  const editingAgentId = editing && editing !== "new" ? editing.id : "";
  const open = (agent: PersonalAgent | "new") => {
    setEditing(agent);
    setName(agent === "new" ? "" : agent.name);
    setDescription(agent === "new" ? "" : agent.description);
    setInstructions(agent === "new" ? "" : agent.instructions);
    setModelId(agent === "new" || !agent.model_id ? initialAgentModelId : agent.model_id);
    setReasoningEffort(agent === "new" ? "" : (agent.reasoning_effort ?? ""));
    setDefaultRunMode(agent === "new" ? "auto" : (agent.default_run_mode ?? "auto"));
    setVoiceId(agent === "new" ? "alloy" : (agent.voice_id ?? "alloy"));
    setAvatarFile(null);
    setError("");
  };
  const close = () => setEditing(null);
  const submit = async () => {
    if (!name.trim() || !modelId || saving) return;
    setSaving(true);
    setError("");
    try {
      const current = editing === "new" ? null : editing;
      let saved = await save(current?.id ?? null, {
        name: name.trim(),
        role: current?.role ?? "",
        description: description.trim(),
        avatar: current?.avatar,
        icon: current?.icon ?? "",
        instructions: instructions.trim(),
        model_mode: "pinned",
        model_id: modelId,
        reasoning_effort: supportsReasoning ? reasoningEffort || "medium" : "",
        default_run_mode: defaultRunMode,
        voice_id: voiceId,
        enabled: current?.enabled ?? true,
        version: current?.version,
      });
      if (avatarFile) {
        saved = await personalAgentsApi.uploadAvatar(saved.id, avatarFile);
        setAvatarFile(null);
        await load();
      }
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
    defaultRunMode,
    setDefaultRunMode,
    voiceId,
    setVoiceId,
    avatarFile,
    setAvatarFile,
    saving,
    error,
    supportsReasoning,
    open,
    close,
    submit,
    deleteAgent,
  };
}

export type AgentEditorState = ReturnType<typeof useAgentEditor>;
