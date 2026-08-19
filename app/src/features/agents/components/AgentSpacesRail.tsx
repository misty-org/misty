import type { PersonalAgentActivityPage } from "../model/interfaces/personal";

export function AgentSpacesRail({ activity }: { activity?: PersonalAgentActivityPage | null }) {
  const spaces = new Map<string, PersonalAgentActivityPage["runs"]>();
  for (const run of activity?.runs ?? []) {
    const items = spaces.get(run.space_name) ?? [];
    items.push(run);
    spaces.set(run.space_name, items);
  }
  return (
    <aside
      aria-label="Agents by space"
      className="flex h-full min-h-0 flex-col gap-5 overflow-y-auto border-l border-charcoal-border bg-charcoal-sidebar px-3 py-4"
    >
      <div className="px-2 text-[10px] font-medium uppercase tracking-wider text-cream-muted">
        Recent Spaces
      </div>
      {spaces.size === 0 ? (
        <p className="m-0 px-2 text-xs leading-5 text-cream-muted">
          No assigned-task activity yet.
        </p>
      ) : null}
      {[...spaces.entries()].map(([space, runs]) => (
        <section key={space}>
          <div className="mb-1.5 px-2 text-[10px] font-medium uppercase tracking-wider text-cream-muted">
            {space}
          </div>
          <ul className="m-0 grid list-none gap-0.5 p-0">
            {runs.slice(0, 4).map((run) => (
              <li key={run.run_id} className="rounded-md px-2 py-1.5">
                <div className="truncate text-xs text-cream">
                  {run.task_id
                    ? `${run.task_key} · ${run.task_title}`
                    : run.trigger_kind === "delegated"
                      ? "Delegated work"
                      : "Direct instruction"}
                </div>
                <div className="mt-0.5 truncate text-[10.5px] capitalize text-cream-muted">
                  {(run.state === "completed" && run.has_failed_steps
                    ? "completed_with_errors"
                    : run.state
                  ).replace(/_/g, " ")}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </aside>
  );
}
