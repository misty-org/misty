import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarClock, Pencil, Plus, Workflow } from "lucide-react";
import {
  agentMethodsApi,
  type AgentMethod,
  type AgentMethodDefinition,
  type AgentMethodKind,
  type SaveAgentMethod,
} from "@/api/ai/agent-methods";
import { scheduledTasksApi, type ScheduledTask } from "@/api/scheduled/api";
import { useMistyStore } from "@/features/misty/useMistyStore";
import { Button, Input } from "@/shared/ui";
import {
  AgentMethodEditor,
  blankDefinition,
  methodError,
  methodTargets,
} from "./AgentMethodEditor";
import { AgentMethodRunDialog } from "./AgentMethodRunDialog";
import "./agentMethods.css";

export function AgentMethodsCatalog({
  agentId,
  kind,
  onUse,
  onConversation,
  onStartWork,
  children,
}: {
  agentId: string;
  kind: AgentMethodKind;
  onUse(prompt: string): void;
  onConversation(id: string): void;
  onStartWork(action: () => void): void;
  children?: React.ReactNode;
}) {
  const navigate = useNavigate();
  const [methods, setMethods] = useState<AgentMethod[]>([]);
  const [schedules, setSchedules] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<{
    method?: AgentMethod;
    initial?: AgentMethodDefinition;
  } | null>(null);
  const [action, setAction] = useState<{ method: AgentMethod; schedule?: boolean } | null>(null);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const generation = useRef(0);
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
  const refresh = useCallback(async () => {
    const own = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const [saved, tasks] = await Promise.all([
        agentMethodsApi.list(agentId),
        scheduledTasksApi.list(),
      ]);
      if (own !== generation.current) return;
      setMethods(saved.methods);
      setSchedules(tasks.tasks.filter((t) => t.agent_id === agentId && t.method_version_id));
    } catch (cause) {
      if (own === generation.current) setError(methodError(cause));
    } finally {
      if (own === generation.current) setLoading(false);
    }
  }, [agentId]);
  const invalidateRequests = useCallback(() => {
    generation.current++;
  }, []);
  useEffect(() => {
    void refresh();
    return invalidateRequests;
  }, [refresh, invalidateRequests]);
  const save = async (input: SaveAgentMethod) => {
    const { method } = await agentMethodsApi.save(input);
    setMethods((all) => [method, ...all.filter((m) => m.id !== method.id)]);
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
  const scheduleAction = async (task: ScheduledTask, remove = false) => {
    if (busy) return;
    setBusy(task.id);
    setError("");
    try {
      if (remove) {
        await scheduledTasksApi.remove(task.id);
        setSchedules((all) => all.filter((t) => t.id !== task.id));
      } else {
        const { task: updated } = await scheduledTasksApi.update(task.id, {
          title: task.title,
          prompt: task.prompt,
          agent_id: task.agent_id,
          method_version_id: task.method_version_id,
          method_inputs: task.method_inputs,
          cadence: task.cadence,
          local_time: task.local_time,
          weekday: task.weekday,
          month_day: task.month_day,
          run_on: task.run_on,
          timezone: task.timezone,
          enabled: !task.enabled,
        });
        setSchedules((all) => all.map((t) => (t.id === task.id ? updated : t)));
      }
    } catch (cause) {
      setError(methodError(cause));
    } finally {
      setBusy("");
    }
  };
  const visible = methods.filter(
    (m) =>
      m.kind === kind &&
      `${m.definition.title} ${m.definition.description}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <div className="agent-studio-workflows agent-method-catalog">
      <header className="agent-studio-heading">
        <div>
          <h1>{kind === "workflow" ? "Workflows" : kind === "template" ? "Tasks" : "Skills"}</h1>
          <p>
            {kind === "workflow"
              ? "Repeat a method, with the inputs and work location you choose."
              : kind === "template"
                ? "Start from a saved prompt. Review it before sending."
                : "Reusable guidance for this agent’s new tasks."}
          </p>
        </div>
        <Button onClick={() => setEditor({})}>
          <Plus size={14} />
          New {kind}
        </Button>
      </header>
      <Input
        aria-label={`Search ${kind}s`}
        placeholder={`Search ${kind}s…`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
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
      {loading ? (
        <p role="status" className="agent-studio-catalog-empty">
          Loading {kind}s…
        </p>
      ) : visible.length ? (
        <div className="agent-method-list">
          {visible.map((method) => (
            <article className="agent-method-row" key={method.id}>
              <div>
                <h2>{method.definition.title}</h2>
                <p>{method.definition.description}</p>
                <span>
                  Version {method.version} · {method.enabled ? "Enabled" : "Disabled"} ·{" "}
                  {methodTargets.find((t) => t.value === method.definition.target)?.label}
                </span>
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
                  {method.enabled ? "Disable" : "Enable"}
                </Button>
                {kind !== "skill" && (
                  <Button
                    size="sm"
                    disabled={!method.enabled || working || !!busy}
                    onClick={() => setAction({ method })}
                  >
                    {kind === "template" ? "Use template" : "Run"}
                  </Button>
                )}
                {kind === "workflow" && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!method.enabled || !!busy}
                    onClick={() => setAction({ method, schedule: true })}
                  >
                    <CalendarClock size={13} />
                    Schedule
                  </Button>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <section className="agent-studio-workflow-empty">
          <Workflow size={28} />
          <h2>{query ? "No matching methods" : `No ${kind}s yet`}</h2>
          <p>
            {query
              ? "Try another search."
              : "Start with your own instructions or save a method from a successful task."}
          </p>
        </section>
      )}
      {kind === "workflow" && schedules.length > 0 && (
        <section className="agent-method-schedules">
          <h2>Scheduled workflows</h2>
          {schedules.map((task) => (
            <article className="agent-method-row" key={task.id}>
              <div>
                <h3>{task.title}</h3>
                <p>
                  {task.cadence} at {task.local_time} · {task.timezone} ·{" "}
                  {task.enabled ? task.state : "Paused"}
                </p>
                <span>
                  {methods.find((m) => m.version_id === task.method_version_id)
                    ? `Version ${methods.find((m) => m.version_id === task.method_version_id)!.version}`
                    : "Saved earlier version"}{" "}
                  ·{" "}
                  {task.next_run_at
                    ? `Next ${new Date(task.next_run_at).toLocaleString()}`
                    : "No upcoming run"}
                </span>
                {task.last_error && <p role="status">{task.last_error}</p>}
              </div>
              <div className="agent-method-actions">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    navigate(`/agents?view=scheduled&task=${encodeURIComponent(task.id)}`)
                  }
                >
                  Open schedule
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!!busy}
                  onClick={() => void scheduleAction(task)}
                >
                  {task.enabled ? "Pause" : "Resume"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!!busy}
                  onClick={() => void scheduleAction(task, true)}
                >
                  Remove schedule
                </Button>
              </div>
            </article>
          ))}
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
      {action && (
        <AgentMethodRunDialog
          method={action.method}
          schedule={!!action.schedule}
          onClose={() => setAction(null)}
          onUse={onUse}
          onConversation={onConversation}
          onStartWork={onStartWork}
          onScheduled={(task) => {
            setSchedules((all) => [task, ...all]);
            setNotice("Schedule saved. Its workflow version is pinned.");
          }}
        />
      )}
    </div>
  );
}
