import { FileText } from "lucide-react";
import { agentChecklist, agentRequest } from "../../data/project";
import type { AgentsState } from "../../film/state";
import { Spin } from "../Spin";
import { Cloud, clouds } from "./Cloud";

/** Lines of the reply in reveal order: intro, then each group title and item. */
const lines = [
  { kind: "intro" as const, text: agentChecklist.intro },
  ...agentChecklist.groups.flatMap((group) => [
    { kind: "title" as const, text: group.title },
    ...group.items.map((text) => ({ kind: "item" as const, text })),
  ]),
];

export function AgentConversation({ state }: { state: AgentsState }) {
  if (!state.sent) return <div className="flex-1" />;
  const shown = Math.floor((state.reply ?? 0) * lines.length + 0.0001);
  const reading = (state.working ?? 0) < 1;
  return (
    <div className="mx-auto w-full max-w-[780px] flex-1 px-6 pt-6">
      <div className="flex flex-col items-end gap-2">
        <span className="inline-flex items-center gap-2 rounded-md border border-charcoal-border px-2 py-1 text-xs text-cream-muted">
          <FileText className="size-3.5" aria-hidden /> Launch brief
        </span>
        <p className="rounded-xl bg-[#1d1d1d] px-3.5 py-2.5 text-sm text-cream-bright">{agentRequest}</p>
      </div>
      <div className="mt-5 flex gap-3">
        <Cloud src={clouds.mint} size={28} />
        {reading ? (
          <p className="flex items-center gap-2 pt-1 text-sm text-cream-muted" data-t="agent-working">
            <Spin t={state.working ?? 0} /> Reading Launch brief…
          </p>
        ) : (
          <div
            className="min-w-0 flex-1 rounded-xl border border-charcoal-border bg-[#161616] px-4 py-3.5 text-sm leading-relaxed text-cream"
            data-t="agent-reply"
          >
            {lines.slice(0, Math.max(1, shown)).map((line) =>
              line.kind === "intro" ? (
                <p key={line.text}>{line.text}</p>
              ) : line.kind === "title" ? (
                <p key={line.text} className="mt-3 mb-1.5 font-semibold text-cream-bright">
                  {line.text}
                </p>
              ) : (
                <p key={line.text} className="flex items-center gap-2.5 py-1">
                  <span className="size-4 shrink-0 rounded-[4px] border border-cream-muted" />
                  {line.text}
                </p>
              ),
            )}
          </div>
        )}
      </div>
    </div>
  );
}
