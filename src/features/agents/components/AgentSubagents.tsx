import { Check, Circle, Loader2, Square, X } from "lucide-react";
import { useState } from "react";
import { aiSurfaceApi } from "@/features/ai-surface/api";
import type { AgentSubagent } from "@/features/ai-surface/types";
import { Button } from "@/shared/ui";

const running = new Set([
  "queued",
  "running",
  "awaiting_approval",
  "awaiting_device",
  "awaiting_intervention",
  "awaiting_timer",
]);

/** Status as text and an icon, never color alone. */
function status(state: string) {
  if (state === "completed") return { label: "Done", Icon: Check, spin: false };
  if (state === "failed") return { label: "Didn’t finish", Icon: X, spin: false };
  if (state === "canceled") return { label: "Stopped", Icon: Square, spin: false };
  if (state === "queued") return { label: "Starting", Icon: Circle, spin: false };
  if (state.startsWith("awaiting")) return { label: "Waiting", Icon: Circle, spin: false };
  return { label: "Working", Icon: Loader2, spin: true };
}

/** The sub-agents a run started, each with its progress and a Stop. */
export function AgentSubagents({ subagents }: { subagents: AgentSubagent[] }) {
  const [stopping, setStopping] = useState<Record<string, boolean>>({});
  if (!subagents.length) return null;
  const stop = async (id: string) => {
    setStopping((current) => ({ ...current, [id]: true }));
    await aiSurfaceApi.cancelInvocation(id).catch(() => undefined);
  };
  return (
    <section
      aria-label="Sub-agents"
      className="mt-3 rounded-lg border border-charcoal-border bg-charcoal-card p-3"
    >
      <strong className="text-xs text-cream-bright">
        {subagents.length === 1 ? "1 sub-agent" : `${subagents.length} sub-agents`}
      </strong>
      <ul className="mt-2 grid gap-2">
        {subagents.map((subagent) => {
          const { label, Icon, spin } = status(subagent.state);
          const active = running.has(subagent.state) && !stopping[subagent.invocationId];
          return (
            <li key={subagent.invocationId} className="flex items-start gap-2">
              <Icon
                className={
                  spin
                    ? "mt-0.5 size-3.5 shrink-0 animate-spin text-cream-muted"
                    : "mt-0.5 size-3.5 shrink-0 text-cream-muted"
                }
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <p className="break-words text-[12px] leading-5 text-cream">{subagent.goal}</p>
                <p className="text-[11px] leading-4 text-cream-muted">
                  {stopping[subagent.invocationId] && running.has(subagent.state)
                    ? "Stopping"
                    : label}
                  {subagent.summary ? ` · ${subagent.summary}` : ""}
                </p>
              </div>
              {active ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-[11px]"
                  aria-label={`Stop sub-agent: ${subagent.goal}`}
                  onClick={() => void stop(subagent.invocationId)}
                >
                  Stop
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
