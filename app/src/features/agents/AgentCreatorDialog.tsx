import { analytics } from "@/telemetry/client";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ScrollArea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { useEffect, useState } from "react";
import { AgentCreatorBehaviorStep } from "./AgentCreatorBehaviorStep";
import { AgentCreatorIdentityStep } from "./AgentCreatorIdentityStep";
import { composeAgentInstructions } from "./agentCreatorState";
import type { AgentRunMode, ReasoningEffort } from "./model/interfaces/personal";
import { initialAgentModelId, modelSupportsReasoning } from "./modelSelection";
import { personalAgentsApi, usePersonalAgentsStore } from "./store/usePersonalAgentsStore";

export function AgentCreatorDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultSpaceId?: string;
  onCreated?: (agentId: string) => void;
}) {
  const { models, save, load } = usePersonalAgentsStore();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [purpose, setPurpose] = useState("");
  const [instructions, setInstructions] = useState("");
  const [personality, setPersonality] = useState("thoughtful");
  const [communicationStyle, setCommunicationStyle] = useState("concise");
  const [modelId, setModelId] = useState(initialAgentModelId);
  const [reasoning, setReasoning] = useState<ReasoningEffort>("medium");
  const [runMode, setRunMode] = useState<AgentRunMode>("auto");
  const [preset, setPreset] = useState("bot");
  const [accent, setAccent] = useState("indigo");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const supportsReasoning = modelSupportsReasoning(
    models.find((model) => model.id === modelId)?.capabilities,
  );
  useEffect(() => {
    if (!open) return;
    setStep(0);
    setName("");
    setRole("");
    setPurpose("");
    setInstructions("");
    setPersonality("thoughtful");
    setCommunicationStyle("concise");
    setModelId(initialAgentModelId);
    setReasoning("medium");
    setRunMode("auto");
    setPreset("bot");
    setAccent("indigo");
    setAvatarFile(null);
    setError("");
    void load();
  }, [load, open]);
  const canContinue = step === 0 ? Boolean(name.trim() && role.trim() && purpose.trim()) : true;
  const createAgent = async () => {
    if (!canContinue || saving) return;
    setSaving(true);
    setError("");
    try {
      let saved = await save(null, {
        name: name.trim(),
        role: role.trim(),
        description: purpose.trim(),
        icon: preset,
        avatar: { kind: "preset", preset_id: preset, accent },
        instructions: composeAgentInstructions(personality, communicationStyle, instructions),
        model_mode: "pinned",
        model_id: modelId,
        reasoning_effort: supportsReasoning ? reasoning : "",
        default_run_mode: runMode,
        voice_id: "alloy",
        enabled: true,
      });
      if (avatarFile) saved = await personalAgentsApi.uploadAvatar(saved.id, avatarFile);
      await load();
      analytics.track("agent_creation_completed", {
        default_run_mode: runMode,
        avatar_kind: avatarFile ? "upload" : "preset",
      });
      onCreated?.(saved.id);
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The Agent could not be created.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="flex h-[min(720px,calc(100vh-40px))] w-[min(720px,calc(100vw-40px))] max-w-none flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-6 pb-4 pt-5">
          <DialogTitle>Create a companion Agent</DialogTitle>
          <DialogDescription>
            Your Agent is automatically available in every Space you can access. Only you can
            instruct or approve it.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="min-h-0 flex-1">
          <div className="grid gap-5 px-6 py-5">
            {step === 0 ? (
              <AgentCreatorIdentityStep
                name={name}
                role={role}
                purpose={purpose}
                preset={preset}
                accent={accent}
                avatarFile={avatarFile}
                onNameChange={setName}
                onRoleChange={setRole}
                onPurposeChange={setPurpose}
                onPresetChange={setPreset}
                onAccentChange={setAccent}
                onAvatarFileChange={setAvatarFile}
                onError={setError}
              />
            ) : (
              <>
                <AgentCreatorBehaviorStep
                  personality={personality}
                  communicationStyle={communicationStyle}
                  instructions={instructions}
                  models={models}
                  modelId={modelId}
                  reasoning={reasoning}
                  supportsReasoning={supportsReasoning}
                  onPersonalityChange={setPersonality}
                  onCommunicationStyleChange={setCommunicationStyle}
                  onInstructionsChange={setInstructions}
                  onModelChange={setModelId}
                  onReasoningChange={setReasoning}
                />
                <div className="grid gap-2">
                  <label className="text-sm font-medium">Default run mode</label>
                  <Select
                    value={runMode}
                    onValueChange={(value) => setRunMode(value as AgentRunMode)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ask">Ask for approval</SelectItem>
                      <SelectItem value="auto">Approve routine work</SelectItem>
                      <SelectItem value="full">Full access</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="m-0 text-xs text-cream-muted">
                    Dangerous actions always pause for your approval, even in Full access.
                  </p>
                </div>
              </>
            )}
            {error ? (
              <p role="alert" className="text-sm text-cream-bright">
                {error}
              </p>
            ) : null}
          </div>
        </ScrollArea>
        <DialogFooter className="flex-row items-center justify-between border-t px-6 py-4 sm:justify-between">
          {step === 1 ? (
            <Button type="button" variant="ghost" disabled={saving} onClick={() => setStep(0)}>
              <ArrowLeft size={15} />
              Back
            </Button>
          ) : (
            <span />
          )}
          {step === 0 ? (
            <Button type="button" disabled={!canContinue} onClick={() => setStep(1)}>
              Continue
              <ArrowRight size={15} />
            </Button>
          ) : (
            <Button type="button" disabled={saving} onClick={() => void createAgent()}>
              {saving ? "Creating…" : "Create companion"}
              <Check size={15} />
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
