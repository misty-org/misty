import { personalAgentsApi } from "./personalAgentsApi";
import type { AgentProfile, AgentProfileInput } from "@/shared/schemas";
import {
  BackButton,
  Button,
  ChoiceGroup,
  ChoiceList,
  ChoiceTile,
  Field,
  Input,
  Popover,
  PopoverBody,
  PopoverContent,
  PopoverHeader,
  PopoverTrigger,
  Text,
  Textarea,
  useNotice,
} from "@/shared/ui";
import { useEffect, useRef, useState } from "react";
import { AgentAvatar, AgentCloudImage } from "./AgentAvatar";
import { agentCloudVariants } from "./agentCloudAvatars";
import { AgentAccess, type AgentAccessState } from "./AgentAccess";
import { hasTauriInternals } from "@/shared/platform/tauri";

export function AgentSetup(props: {
  access: AgentAccessState;
  onConnections(): void;
  onStatusChange(status: { dirty: boolean; busy: boolean }): void;
  onSaved(id: string, companion?: boolean): Promise<void>;
}) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<AgentProfileInput>({
    default_run_mode: "ask",
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
  });
  const [companion, setCompanion] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const createdId = useRef<string | undefined>(undefined);
  const live = useRef(true);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const { onStatusChange } = props;
  const dirty = Boolean(
    draft.name ||
    draft.description ||
    draft.instructions ||
    step ||
    draft.avatar.cloudVariant !== "lavender",
  );
  useEffect(() => {
    onStatusChange({ dirty, busy });
    return () => onStatusChange({ dirty: false, busy: false });
  }, [dirty, busy, onStatusChange]);
  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);
  const desktop = hasTauriInternals() && /Mac|Win/.test(navigator.platform);
  const finish = async () => {
    if (busy || !draft.name.trim()) return;
    setBusy(true);
    setError("");
    try {
      // If refreshing the list fails after creation, retry completion without creating a duplicate.
      const id = createdId.current ?? (await personalAgentsApi.save(draft)).id;
      createdId.current = id;
      if (live.current) await props.onSaved(id, companion);
    } catch (reason) {
      if (live.current)
        setError(reason instanceof Error ? reason.message : "Agent setup couldn’t finish.");
    } finally {
      if (live.current) setBusy(false);
    }
  };
  const titles = ["Meet your agent", "Give it context", "Choose where to begin"];
  useNotice(Boolean(error), { message: error, tone: "error", onDismiss: () => setError("") });
  return (
    <form
      className="grid gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        if (step < 2) setStep(step + 1);
        else void finish();
      }}
    >
      <header className="grid justify-items-center gap-3 text-center">
        <AgentAvatar agent={{ ...draft, id: "new-agent" } as AgentProfile} large />
        <Text
          bare
          as="h2"
          tone="bright"
          ref={headingRef}
          tabIndex={-1}
          className="text-xl font-medium outline-none"
        >
          {titles[step]}
        </Text>
      </header>
      <ChoiceGroup
        label="Agent setup steps"
        className="justify-self-center"
        value={String(step)}
        onChange={(next) => setStep(Number(next))}
        options={["Identity", "Context", "Start"].map((label, index) => ({
          value: String(index),
          label,
          disabled: busy || (index > 0 && !draft.name.trim()),
          reason: busy ? undefined : "Name your agent first",
        }))}
      />
      <fieldset disabled={busy} className="grid min-w-0 gap-4">
        {step === 0 && (
          <>
            <Popover>
              <PopoverTrigger asChild>
                <Button type="button" className="justify-self-center">
                  Change avatar
                </Button>
              </PopoverTrigger>
              <PopoverContent>
                <PopoverHeader title="Avatar" />
                <PopoverBody role="group" aria-label="Avatar">
                  <div className="grid grid-cols-3 gap-2">
                    {agentCloudVariants.map((variant) => (
                      <ChoiceTile
                        key={variant.id}
                        label={variant.name}
                        caption={variant.name}
                        selected={draft.avatar.cloudVariant === variant.id}
                        onSelect={() =>
                          setDraft({ ...draft, avatar: { cloudVariant: variant.id } })
                        }
                      >
                        <span className="size-12">
                          <AgentCloudImage variant={variant} />
                        </span>
                      </ChoiceTile>
                    ))}
                  </div>
                </PopoverBody>
              </PopoverContent>
            </Popover>
            <Field label="Name">
              <Input
                required
                maxLength={80}
                value={draft.name}
                placeholder="Research partner"
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </Field>
            <Field label="Purpose">
              <Textarea
                maxLength={2000}
                value={draft.description}
                placeholder="What would you like help with?"
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </Field>
            <details className="py-1">
              <Text as="summary" bare size="control" tone="muted" className="cursor-pointer">
                Instructions
              </Text>
              <div className="grid gap-4 pt-4">
                <Field label="Instructions">
                  <Textarea
                    maxLength={16000}
                    value={draft.instructions}
                    onChange={(e) => setDraft({ ...draft, instructions: e.target.value })}
                  />
                </Field>
              </div>
            </details>
          </>
        )}
        {step === 1 && <AgentAccess access={props.access} onConnections={props.onConnections} />}
        {step === 2 && (
          <>
            <ChoiceList
              label="Start with"
              options={[
                {
                  value: "chat",
                  label: "Chat in Misty",
                  description: "Start a conversation with your new agent.",
                },
                {
                  value: "companion",
                  label: "Desktop companion",
                  description: desktop
                    ? "Open voice and computer controls after setup."
                    : "Available in Misty for macOS and Windows.",
                  disabled: !desktop,
                },
              ]}
              selected={[companion ? "companion" : "chat"]}
              onSelect={(value) => setCompanion(value === "companion")}
            />
            <Text bare as="p" tone="muted" className="text-xs">
              Your agent uses your account’s existing access. You can change companion settings
              anytime.
            </Text>
          </>
        )}
      </fieldset>
      <div className="flex items-center justify-between gap-3">
        {step > 0 ? (
          <BackButton size="lg" disabled={busy} onClick={() => setStep(step - 1)} />
        ) : (
          <span />
        )}
        <Button
          type="submit"
          variant="primary"
          size="lg"
          loading={busy}
          disabled={!draft.name.trim()}
        >
          {step === 2 ? "Create agent" : "Continue"}
        </Button>
      </div>
    </form>
  );
}
