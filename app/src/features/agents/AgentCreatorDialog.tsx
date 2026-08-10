import { useAuth } from "@/features/auth";
import { useSpacesStore } from "@/features/spaces";
import { spacesApi } from "@/api/spaces/api";
import type { AgentToolboxAction } from "@/api/spaces/dto/interfaces/agentArchitectureTypes";
import { analytics } from "@/telemetry/client";
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  ScrollArea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  cn,
} from "@/shared/ui";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AgentAvatar } from "./AgentAvatar";
import { AgentCreatorBehaviorStep } from "./AgentCreatorBehaviorStep";
import { AgentCreatorIdentityStep } from "./AgentCreatorIdentityStep";
import { agentSpaceAudienceGrants, composeAgentInstructions } from "./agentCreatorState";
import type { ReasoningEffort } from "./model/interfaces/personal";
import { initialAgentModelId, modelSupportsReasoning } from "./modelSelection";
import { personalAgentsApi, usePersonalAgentsStore } from "./store/usePersonalAgentsStore";

const steps = ["Identity", "Behavior", "Responsibilities", "Team placement"];
const readableContext = {
  space_chat: "Space chat",
  library: "Library and attached files",
  task_notes: "Task notes",
  tasks: "Planner tasks",
  members: "Team roster",
};
export function AgentCreatorDialog({
  open,
  onOpenChange,
  defaultSpaceId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultSpaceId?: string;
  onCreated?: (agentId: string) => void;
}) {
  const { models, save, load } = usePersonalAgentsStore();
  const { user } = useAuth();
  const spaces = useSpacesStore((state) => state.spaces);
  const loadMembers = useSpacesStore((state) => state.loadMembers);
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [purpose, setPurpose] = useState("");
  const [instructions, setInstructions] = useState("");
  const [personality, setPersonality] = useState("thoughtful");
  const [communicationStyle, setCommunicationStyle] = useState("concise");
  const [modelId, setModelId] = useState(initialAgentModelId);
  const [reasoning, setReasoning] = useState<ReasoningEffort>("medium");
  const [preset, setPreset] = useState("bot");
  const [accent, setAccent] = useState("indigo");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [context, setContext] = useState<Record<string, boolean>>(
    Object.fromEntries(Object.keys(readableContext).map((key) => [key, true])),
  );
  const [actions, setActions] = useState<AgentToolboxAction[]>([]);
  const [spaceRoles, setSpaceRoles] = useState<Record<string, string>>({});
  const [spaceInstructions, setSpaceInstructions] = useState<Record<string, string>>({});
  const [spaceAccess, setSpaceAccess] = useState<Record<string, "all_members" | "creator_only">>(
    {},
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const eligibleSpaces = useMemo(
    () =>
      spaces.filter(
        (space) => space.role === "owner" || space.permissions?.["agents.manage"] === true,
      ),
    [spaces],
  );
  const selectedModel = models.find((model) => model.id === modelId);
  const supportsReasoning = modelSupportsReasoning(selectedModel?.capabilities);
  const selectedSpaces = Object.keys(spaceRoles);

  const toggleSpacePlacement = (spaceId: string, selected: boolean) => {
    setSpaceRoles((current) => {
      const next = { ...current };
      if (selected) next[spaceId] = role.trim();
      else delete next[spaceId];
      return next;
    });
    setSpaceAccess((current) => {
      const next = { ...current };
      if (selected) next[spaceId] = "all_members";
      else delete next[spaceId];
      return next;
    });
    if (!selected) {
      setSpaceInstructions((current) => {
        const next = { ...current };
        delete next[spaceId];
        return next;
      });
    }
  };

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setName("");
    setRole("");
    setPurpose("");
    setInstructions("");
    setPersonality("thoughtful");
    setCommunicationStyle("concise");
    setPreset("bot");
    setAccent("indigo");
    setAvatarFile(null);
    setContext(Object.fromEntries(Object.keys(readableContext).map((key) => [key, true])));
    setSpaceRoles({});
    setSpaceInstructions({});
    setSpaceAccess({});
    setError("");
    void load();
    if (defaultSpaceId && eligibleSpaces.some((space) => space.id === defaultSpaceId)) {
      setSpaceRoles({ [defaultSpaceId]: "" });
      setSpaceAccess({ [defaultSpaceId]: "all_members" });
      void loadMembers(defaultSpaceId).catch(() => undefined);
    }
    void personalAgentsApi
      .toolboxCatalog()
      .then((response) => setActions(response.actions))
      .catch(() => setError("The Agent Toolbox could not be loaded."));
  }, [defaultSpaceId, eligibleSpaces, load, loadMembers, open]);

  const canContinue =
    step === 0
      ? Boolean(name.trim() && role.trim() && purpose.trim())
      : step === 2
        ? actions.length > 0
        : true;

  const createAgent = async () => {
    if (!canContinue || saving) return;
    setSaving(true);
    setError("");
    try {
      const grants = actions
        .filter((action) => action.granted)
        .map((action) => ({ capability: action.name, risk: action.risk }));
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
        context_permissions: context,
        tool_permissions: {
          read: grants.some((grant) => grant.risk === "read"),
          write: grants.some((grant) => grant.risk !== "read"),
          integrations: [],
          grants,
        },
        enabled: true,
      });
      if (avatarFile) saved = await personalAgentsApi.uploadAvatar(saved.id, avatarFile);
      const placements = await Promise.allSettled(
        selectedSpaces.map(async (spaceId) => {
          const membership = await spacesApi.addSpaceAgent(
            spaceId,
            saved.id,
            spaceRoles[spaceId] || role.trim(),
          );
          if (!spaceInstructions[spaceId]?.trim()) return membership;
          return spacesApi.updateSpaceAgent(spaceId, membership, {
            enabled: membership.enabled,
            space_role: membership.space_role,
            space_instructions: spaceInstructions[spaceId].trim(),
            permissions: membership.permissions,
          });
        }),
      );
      if (placements.some((result) => result.status === "rejected")) {
        throw new Error("The Agent was created, but one or more Space placements need attention.");
      }
      // Placement creates or refreshes the Space membership with a safe public
      // default. Apply the owner-authored audience last so "Only me" cannot be
      // widened back to all members by the placement upsert.
      await personalAgentsApi.replaceGrants(
        saved.id,
        agentSpaceAudienceGrants(selectedSpaces, spaceAccess, user?.id),
      );
      await load();
      analytics.track("agent_creation_completed", {
        placed_space_count: selectedSpaces.length,
        enabled_action_count: grants.length,
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
      <DialogContent className="flex h-[min(760px,calc(100vh-40px))] w-[min(760px,calc(100vw-40px))] max-w-none flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-6 pb-4 pt-5">
          <DialogTitle>Create a teammate</DialogTitle>
          <DialogDescription>
            Customize a professional Agent, then choose exactly where and how it can work.
          </DialogDescription>
          <ol className="mt-4 grid grid-cols-4 gap-2" aria-label="Agent creation progress">
            {steps.map((label, index) => (
              <li key={label} className="min-w-0">
                <div
                  className={cn(
                    "mb-1 h-1 rounded-full",
                    index <= step ? "bg-charcoal-active" : "bg-charcoal-card",
                  )}
                />
                <span
                  className={cn(
                    "truncate text-xs",
                    index === step ? "font-medium text-cream" : "text-cream-muted",
                  )}
                >
                  {index + 1}. {label}
                </span>
              </li>
            ))}
          </ol>
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
            ) : null}

            {step === 1 ? (
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
            ) : null}

            {step === 2 ? (
              <>
                <fieldset className="grid gap-2 rounded-xl border p-4">
                  <legend className="px-1 text-sm font-medium">Readable context</legend>
                  {Object.entries(readableContext).map(([key, label]) => (
                    <Label key={key} className="flex items-center gap-2 font-normal">
                      <Checkbox
                        checked={context[key]}
                        onCheckedChange={(checked) =>
                          setContext((current) => ({ ...current, [key]: checked === true }))
                        }
                      />
                      {label}
                    </Label>
                  ))}
                </fieldset>
                <fieldset className="grid gap-2 rounded-xl border p-4">
                  <legend className="px-1 text-sm font-medium">Agent Toolbox</legend>
                  {actions.map((action, index) => (
                    <Label
                      key={action.name}
                      className="flex items-start gap-3 rounded-lg p-2 font-normal hover:bg-charcoal-card"
                    >
                      <Checkbox
                        checked={action.granted}
                        onCheckedChange={(checked) =>
                          setActions((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, granted: checked === true } : item,
                            ),
                          )
                        }
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                          <span>{action.name}</span>
                          <Badge variant="outline" className="font-normal">
                            {action.approval === "none"
                              ? "No approval"
                              : action.approval.replace("_", " ")}
                          </Badge>
                        </span>
                        <span className="mt-0.5 block text-xs text-cream-muted">
                          {action.description}
                        </span>
                      </span>
                    </Label>
                  ))}
                </fieldset>
              </>
            ) : null}

            {step === 3 ? (
              <>
                <div className="rounded-xl border bg-charcoal-card p-4">
                  <div className="flex items-center gap-3">
                    <AgentAvatar
                      name={name || "Agent"}
                      avatar={{ kind: "preset", preset_id: preset, accent }}
                      className="size-10"
                    />
                    <div>
                      <p className="font-medium">{name || "Unnamed Agent"}</p>
                      <p className="text-sm text-cream-muted">{role || "No role yet"}</p>
                    </div>
                  </div>
                  <p className="mb-0 mt-3 text-sm text-cream-muted">{purpose}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge variant="secondary" className="capitalize">
                      {personality}
                    </Badge>
                    <Badge variant="secondary" className="capitalize">
                      {communicationStyle}
                    </Badge>
                    <Badge variant="secondary">
                      {Object.values(context).filter(Boolean).length} context sources
                    </Badge>
                    <Badge variant="secondary">
                      {actions.filter((action) => action.granted).length} actions
                    </Badge>
                  </div>
                </div>
                <fieldset className="grid gap-3 rounded-xl border p-4">
                  <legend className="px-1 text-sm font-medium">Eligible Spaces</legend>
                  {eligibleSpaces.map((space) => {
                    const selected = Object.prototype.hasOwnProperty.call(spaceRoles, space.id);
                    return (
                      <div
                        key={space.id}
                        className="grid gap-2 rounded-lg p-2 hover:bg-charcoal-card"
                      >
                        <Label className="flex items-center gap-2 font-normal">
                          <Checkbox
                            checked={selected}
                            onCheckedChange={(checked) =>
                              toggleSpacePlacement(space.id, checked === true)
                            }
                          />
                          <span className="font-medium">{space.name}</span>
                        </Label>
                        {selected ? (
                          <>
                            <Input
                              className="ml-6 w-[calc(100%-24px)]"
                              maxLength={80}
                              value={spaceRoles[space.id]}
                              placeholder="Role in this Space"
                              onChange={(event) =>
                                setSpaceRoles((current) => ({
                                  ...current,
                                  [space.id]: event.target.value,
                                }))
                              }
                            />
                            <Textarea
                              className="ml-6 w-[calc(100%-24px)]"
                              rows={2}
                              maxLength={2000}
                              value={spaceInstructions[space.id] ?? ""}
                              placeholder="Additional instructions for this Space"
                              onChange={(event) =>
                                setSpaceInstructions((current) => ({
                                  ...current,
                                  [space.id]: event.target.value,
                                }))
                              }
                            />
                            <div className="ml-6 grid gap-1">
                              <Label className="text-xs text-cream-muted">
                                Who can work with this Agent?
                              </Label>
                              <Select
                                value={spaceAccess[space.id] ?? "all_members"}
                                onValueChange={(value) =>
                                  setSpaceAccess((current) => ({
                                    ...current,
                                    [space.id]: value as "all_members" | "creator_only",
                                  }))
                                }
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="all_members">
                                    Everyone in this Space
                                  </SelectItem>
                                  <SelectItem value="creator_only">Only me</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </>
                        ) : null}
                      </div>
                    );
                  })}
                  {eligibleSpaces.length === 0 ? (
                    <p className="text-sm text-cream-muted">
                      You can create this Agent privately now and add it to a Space later.
                    </p>
                  ) : null}
                </fieldset>
              </>
            ) : null}
            {error ? (
              <p role="alert" className="text-sm text-cream-bright">
                {error}
              </p>
            ) : null}
          </div>
        </ScrollArea>

        <DialogFooter className="flex-row items-center justify-between border-t px-6 py-4 sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            disabled={step === 0 || saving}
            onClick={() => setStep((current) => current - 1)}
          >
            <ArrowLeft size={15} /> Back
          </Button>
          {step < steps.length - 1 ? (
            <Button
              type="button"
              disabled={!canContinue}
              onClick={() => setStep((current) => current + 1)}
            >
              Continue <ArrowRight size={15} />
            </Button>
          ) : (
            <Button
              type="button"
              disabled={!canContinue || saving}
              onClick={() => void createAgent()}
            >
              {saving ? "Bringing teammate to life…" : "Create teammate"}
              <Check size={15} />
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
