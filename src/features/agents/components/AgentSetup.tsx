import { personalAgentsApi } from "@/api/agents/native";
import type { AgentProfile, AgentProfileInput } from "@/shared/schemas";
import {
  Button,
  Field,
  Input,
  NavIsland,
  NavIslandItem,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Textarea,
  Toggle,
} from "@/shared/ui";
import { Laptop, MessageSquare, Check } from "lucide-react";
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
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="text-xl font-medium text-cream-bright outline-none"
        >
          {titles[step]}
        </h2>
      </header>
      <NavIsland aria-label="Agent setup steps" className="justify-self-center">
        {["Identity", "Context", "Start"].map((label, index) => (
          <NavIslandItem
            key={label}
            active={step === index}
            disabled={busy || (index > 0 && !draft.name.trim())}
            onClick={() => setStep(index)}
          >
            {label}
          </NavIslandItem>
        ))}
      </NavIsland>
      <fieldset disabled={busy} className="grid min-w-0 gap-4">
        {step === 0 && (
          <>
            <Popover>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" size="sm" className="justify-self-center">
                  Change avatar
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72">
                <div className="grid grid-cols-3 gap-2">
                  {agentCloudVariants.map((variant) => (
                    <Toggle
                      key={variant.id}
                      aria-label={variant.name}
                      pressed={draft.avatar.cloudVariant === variant.id}
                      className="h-auto flex-col p-2"
                      onPressedChange={() =>
                        setDraft({ ...draft, avatar: { cloudVariant: variant.id } })
                      }
                    >
                      <span className="size-12">
                        <AgentCloudImage variant={variant} />
                      </span>
                      <span className="text-xs">{variant.name}</span>
                    </Toggle>
                  ))}
                </div>
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
            <details className="agent-advanced-settings">
              <summary>Instructions</summary>
              <div>
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
            <div role="group" aria-label="Start with">
              <Button
                type="button"
                variant="outline"
                aria-pressed={!companion}
                justify="start"
                className="mb-3 h-auto w-full gap-3 whitespace-normal p-4 text-left"
                onClick={() => setCompanion(false)}
              >
                <MessageSquare className="size-5 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block">Chat in Misty</span>
                  <span className="mt-1 block text-xs font-normal text-cream-muted">
                    Start a conversation with your new agent.
                  </span>
                </span>
                {!companion && <Check className="size-4" />}
              </Button>
              <Button
                type="button"
                variant="outline"
                aria-pressed={companion}
                disabled={!desktop}
                justify="start"
                className="h-auto w-full gap-3 whitespace-normal p-4 text-left"
                onClick={() => setCompanion(true)}
              >
                <Laptop className="size-5 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block">Desktop companion</span>
                  <span className="mt-1 block text-xs font-normal text-cream-muted">
                    {desktop
                      ? "Open voice and computer controls after setup."
                      : "Available in Misty for macOS and Windows."}
                  </span>
                </span>
                {companion && <Check className="size-4" />}
              </Button>
            </div>
            <p className="text-xs text-cream-muted">
              Your agent uses your account’s existing access. You can change companion settings
              anytime.
            </p>
          </>
        )}
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-cream-muted">
          {error}
        </p>
      )}
      <div className="flex items-center justify-between gap-3">
        {step > 0 ? (
          <Button type="button" variant="ghost" disabled={busy} onClick={() => setStep(step - 1)}>
            Back
          </Button>
        ) : (
          <span />
        )}
        <Button type="submit" variant="primary" disabled={busy || !draft.name.trim()}>
          {busy ? "Creating…" : step === 2 ? "Create agent" : "Continue"}
        </Button>
      </div>
    </form>
  );
}
