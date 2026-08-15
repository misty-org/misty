interface RailAgent {
  name: string;
  initial: string;
  activity?: string;
  live?: boolean;
}

interface RailSpace {
  name: string;
  agents: RailAgent[];
}

const SPACES: RailSpace[] = [
  {
    name: "Marketing",
    agents: [
      { name: "buzz", initial: "b", live: true, activity: "reading #launch-plan" },
      { name: "copy editor", initial: "c" },
    ],
  },
  {
    name: "Product",
    agents: [
      { name: "PR reviewer", initial: "p", live: true, activity: "reviewing #1204" },
      { name: "meeting notes", initial: "m", activity: "idle 18h" },
    ],
  },
  {
    name: "Research",
    agents: [{ name: "research", initial: "r" }],
  },
];

export function AgentSpacesRail() {
  return (
    <aside
      aria-label="Agents by space"
      className="flex min-h-0 flex-col gap-5 overflow-y-auto border-l border-charcoal-border bg-charcoal-sidebar px-3 py-4"
    >
      {SPACES.map((space) => (
        <section key={space.name}>
          <div className="mb-1.5 px-2 text-[10px] font-medium uppercase tracking-wider text-cream-muted">
            {space.name}
          </div>
          <ul className="m-0 grid list-none gap-0.5 p-0">
            {space.agents.map((agent) => (
              <li
                key={agent.name}
                className="flex items-start gap-2.5 rounded-md px-2 py-1.5"
              >
                <span className="relative mt-0.5 grid size-5 shrink-0 place-items-center rounded-md bg-charcoal-hover text-[10px] font-medium text-cream-bright">
                  {agent.initial}
                  {agent.live ? (
                    <span className="absolute -bottom-0.5 -right-0.5 size-1.5 rounded-full border border-charcoal-sidebar bg-emerald-500" />
                  ) : null}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs text-cream">{agent.name}</div>
                  {agent.activity ? (
                    <div className="mt-0.5 truncate text-[10.5px] text-cream-muted">
                      {agent.activity}
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </aside>
  );
}
