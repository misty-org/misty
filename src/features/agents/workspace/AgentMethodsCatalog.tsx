import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarClock, Pencil, Plus, Workflow } from "lucide-react";
import {
  agentMethodsApi,
  type AgentMethod,
  type AgentMethodDefinition,
  type AgentMethodKind,
  type SaveAgentMethod,
} from "@/api/ai/agent-methods";
import { observeAccountChanges } from "@/api/accountEvents";
import { useMistyStore } from "@/features/misty/useMistyStore";
import { Button, Input, SkeletonList } from "@/shared/ui";
import { describeNextRun, describeSchedule } from "../workflows/scheduleSummary";
import { WorkflowScheduleDialog } from "../workflows/WorkflowScheduleDialog";
import {
  AgentMethodEditor,
  blankDefinition,
  methodError,
  methodTargets,
} from "./AgentMethodEditor";
import { AgentMethodRunDialog } from "./AgentMethodRunDialog";
import "./agentMethods.css";

const copy: Record<AgentMethodKind, { title: string; description: string }> = {
  workflow: {
    title: "Workflows",
    description:
      "Repeat a method on a schedule or whenever you start it, with the inputs and work location you choose.",
  },
  template: {
    title: "Templates",
    description: "Start from a saved prompt. Review it before sending.",
  },
  skill: { title: "Skills", description: "Reusable guidance for this agent’s new tasks." },
};

/**
 * An agent's saved methods of one kind. A workflow carries its own schedule; every
 * scheduled run uses the workflow's latest version. Embedded catalogs drop the page
 * heading for the tab that hosts them.
 */
export function AgentMethodsCatalog({
  agentId,
  kind,
  embedded = false,
  onUse,
  onConversation,
  onStartWork,
  children,
}: {
  agentId: string;
  kind: AgentMethodKind;
  embedded?: boolean;
  onUse(prompt: string): void;
  onConversation(id: string): void;
  onStartWork(action: () => void): void;
  children?: React.ReactNode;
}) {
  const [methods, setMethods] = useState<AgentMethod[]>();
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [scheduledOnly, setScheduledOnly] = useState(false);
  const [editor, setEditor] = useState<{
    method?: AgentMethod;
    initial?: AgentMethodDefinition;
  } | null>(null);
  const [running, setRunning] = useState<AgentMethod | null>(null);
  const [scheduling, setScheduling] = useState<AgentMethod | null>(null);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const generation = useRef(0);
  const accountId = useMistyStore((s) => s.accountId);
  const conversations = useMistyStore((s) => s.conversations);
  const working = useMistyStore((s) => s.working);
  const sources = conversations
    .filter((c) => c.agentId === agentId)
    .flatMap((c) =>
      c.messages
        .filter((m) => m.role === "assistant" && m.state === "completed" && m.invocationId)
        .map((m) => ({
          value: m.invocationId!,
          label: `${c.title || "Untitled task"} · ${new Date(m.createdAt).toLocaleDateString()}`,
        })),
    );
  // Refreshes keep the current list on screen.
  const refresh = useCallback(async () => {
    const own = ++generation.current;
    setError("");
    try {
      const saved = await agentMethodsApi.list(agentId);
      if (own === generation.current) setMethods(saved.methods);
    } catch (cause) {
      if (own === generation.current) setError(methodError(cause));
    }
  }, [agentId]);
  useEffect(() => {
    void refresh();
    const generations = generation;
    return () => {
      generations.current++;
    };
  }, [refresh]);
  // Scheduled runs change a workflow's next and last run while the page is open.
  useEffect(() => {
    if (kind !== "workflow" || !accountId) return;
    return observeAccountChanges(accountId, ["workflows"], refresh);
  }, [kind, accountId, refresh]);
  const replace = (method: AgentMethod) =>
    setMethods((all = []) =>
      all.some((m) => m.id === method.id)
        ? all.map((m) => (m.id === method.id ? method : m))
        : [method, ...all],
    );
  const save = async (input: SaveAgentMethod) => {
    const { method } = await agentMethodsApi.save(input);
    const prior = methods?.find((m) => m.id === method.id);
    replace({ ...method, schedule: method.schedule ?? prior?.schedule });
    setNotice(`Saved ${method.kind} version ${method.version}.`);
  };
  const toggle = async (method: AgentMethod) => {
    if (busy) return;
    setBusy(method.id);
    setError("");
    try {
      await save({ ...method, enabled: !method.enabled, expected_version: method.version });
    } catch (cause) {
      setError(methodError(cause));
    } finally {
      setBusy("");
    }
  };
  const visible = (methods ?? []).filter(
    (m) =>
      m.kind === kind &&
      (!scheduledOnly || m.schedule) &&
      `${m.definition.title} ${m.definition.description}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const { title, description } = copy[kind];
  const create = (
    <Button onClick={() => setEditor({})}>
      <Plus size={14} />
      New {kind}
    </Button>
  );
  return (
    <div
      className={embedded ? "agent-method-catalog" : "agent-studio-workflows agent-method-catalog"}
    >
      {embedded ? (
        <div className="agent-method-toolbar">
          <p className="agent-method-hint">{description}</p>
          {create}
        </div>
      ) : (
        <header className="agent-studio-heading">
          <div>
            <h1>{title}</h1>
            <p>{description}</p>
          </div>
          {create}
        </header>
      )}
      <div className="agent-method-toolbar">
        <Input
          aria-label={`Search ${kind}s`}
          placeholder={`Search ${kind}s…`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {kind === "workflow" && (
          <div role="navigation" aria-label="Workflow sections" className="flex gap-1.5">
            {[
              { label: "All", scheduled: false },
              { label: "Scheduled", scheduled: true },
            ].map((option) => (
              <Button
                key={option.label}
                variant="chip"
                size="chip"
                className="font-normal"
                aria-pressed={scheduledOnly === option.scheduled}
                onClick={() => setScheduledOnly(option.scheduled)}
              >
                {option.label}
              </Button>
            ))}
          </div>
        )}
      </div>
      {error && (
        <div role="alert" className="agent-method-error">
          <p>{error}</p>
          <Button variant="ghost" size="sm" onClick={() => void refresh()}>
            Reload
          </Button>
        </div>
      )}
      {notice && (
        <p role="status" className="agent-method-hint">
          {notice}
        </p>
      )}
      {!methods && !error ? (
        <SkeletonList label={title} rows={3} leading="none" trailing />
      ) : visible.length ? (
        <div className="agent-method-list">
          {visible.map((method) => (
            <article className="agent-method-row" key={method.id}>
              <div>
                <h2>{method.definition.title}</h2>
                <p>{method.definition.description}</p>
                {kind === "workflow" && (
                  <span>
                    {method.schedule
                      ? `${describeSchedule(method.schedule)} · ${describeNextRun(method.schedule)}`
                      : "Runs when you start it"}
                  </span>
                )}
                <span>
                  Version {method.version} · {method.enabled ? "On" : "Off"} ·{" "}
                  {methodTargets.find((t) => t.value === method.definition.target)?.label}
                </span>
                {method.schedule?.state === "failed" && method.schedule.last_error && (
                  <p role="status">Last scheduled run failed: {method.schedule.last_error}</p>
                )}
              </div>
              <div className="agent-method-actions">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!!busy}
                  onClick={() => setEditor({ method })}
                >
                  <Pencil size={13} />
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!!busy}
                  onClick={() => void toggle(method)}
                >
                  {method.enabled ? "Turn off" : "Turn on"}
                </Button>
                {kind === "workflow" && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!!busy}
                    onClick={() => setScheduling(method)}
                  >
                    <CalendarClock size={13} />
                    {method.schedule ? "Edit schedule" : "Schedule"}
                  </Button>
                )}
                {kind !== "skill" && (
                  <Button
                    size="sm"
                    disabled={!method.enabled || working || !!busy}
                    onClick={() => setRunning(method)}
                  >
                    {kind === "template" ? "Use template" : "Run now"}
                  </Button>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <section className="agent-studio-workflow-empty">
          <Workflow size={28} />
          <h2>
            {query
              ? `No matching ${kind}s`
              : scheduledOnly
                ? "No scheduled workflows"
                : `No ${kind}s yet`}
          </h2>
          <p>
            {query
              ? "Try another search."
              : scheduledOnly
                ? "Open a workflow’s Schedule to have it run on its own."
                : "Start with your own instructions or save a method from a successful task."}
          </p>
        </section>
      )}
      {children}
      {editor && (
        <AgentMethodEditor
          agentId={agentId}
          kind={kind}
          method={editor.method}
          initial={editor.initial ?? blankDefinition()}
          sources={sources}
          onClose={() => setEditor(null)}
          onSave={save}
        />
      )}
      {running && (
        <AgentMethodRunDialog
          method={running}
          onClose={() => setRunning(null)}
          onUse={onUse}
          onConversation={onConversation}
          onStartWork={onStartWork}
        />
      )}
      {scheduling && (
        <WorkflowScheduleDialog
          method={scheduling}
          onClose={() => setScheduling(null)}
          onSaved={(schedule) => {
            replace({ ...scheduling, schedule });
            setNotice(
              schedule ? "Schedule saved. Runs use the latest version." : "Schedule removed.",
            );
          }}
        />
      )}
    </div>
  );
}
