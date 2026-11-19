import { itemToneClass, Text, Tooltip } from "@/shared/ui";
import { personTone } from "../../tutor/personTone";
import { authorKey, mainAuthor, ownerKey, type LivePerson, type LiveStep } from "./liveTypes";

/**
 * The history as lanes: main (the base commit, and how far main has moved), live (every step),
 * then a lane per person with one per agent under its owner. A step shows on the live lane and
 * on its author's, joined by a line. Lines take the muted text tone; a step's dot takes its
 * person's tone, the one their avatar wears. Picking a dot opens the step.
 */

const rowHeight = 32;
const column = 14;
const inset = 12;

interface Lane {
  key: string;
  label: string;
  /** The person whose tone the lane's dots wear. */
  personId: string | null;
  agent: boolean;
}

function lanesOf(steps: readonly LiveStep[], people: readonly LivePerson[]): Lane[] {
  const known = new Map<string, LivePerson>();
  for (const person of people) known.set(authorKey(person), person);
  for (const step of steps)
    if (!known.has(authorKey(step.author))) known.set(authorKey(step.author), step.author);
  const persons = [...known.values()].filter(
    (author) => author.kind === "person" && author.id !== mainAuthor.id,
  );
  const lanes: Lane[] = [
    { key: "main", label: "main", personId: null, agent: false },
    { key: "live", label: "Live", personId: null, agent: false },
  ];
  for (const person of persons.sort((a, b) => a.name.localeCompare(b.name))) {
    lanes.push({ key: authorKey(person), label: person.name, personId: person.id, agent: false });
    for (const agent of known.values())
      if (agent.kind === "agent" && ownerKey(agent) === authorKey(person))
        lanes.push({ key: authorKey(agent), label: agent.name, personId: person.id, agent: true });
  }
  return lanes;
}

export function LiveLanes(props: {
  steps: readonly LiveStep[];
  people: readonly LivePerson[];
  mainAhead: number | null;
  selected: string | null;
  onSelect(id: string): void;
}) {
  const steps = [...props.steps].sort((a, b) => a.at - b.at);
  const lanes = lanesOf(steps, props.people);
  const row = new Map(lanes.map((lane, index) => [lane.key, index]));
  const width = inset * 2 + Math.max(steps.length, 1) * column;
  const height = lanes.length * rowHeight;
  const middle = (index: number) => index * rowHeight + rowHeight / 2;
  const x = (index: number) => inset + index * column + column / 2;
  const liveRow = row.get("live")!;
  return (
    <div className="flex min-w-0 px-2" aria-label="Session history">
      <div className="grid w-24 shrink-0">
        {lanes.map((lane) => (
          <div
            key={lane.key}
            className={
              lane.agent ? "flex h-8 min-w-0 items-center pl-3" : "flex h-8 min-w-0 items-center"
            }
          >
            <Text size="meta" tone={lane.personId ? "muted" : "default"}>
              {lane.label}
            </Text>
          </div>
        ))}
      </div>
      <div className="min-w-0 flex-1 overflow-x-auto">
        <Text bare tone="muted" className="block">
          <svg width={width} height={height} role="img" aria-label="Steps by lane">
            {lanes.map((lane, index) => (
              <line
                key={lane.key}
                x1={inset}
                x2={width - inset}
                y1={middle(index)}
                y2={middle(index)}
                stroke="currentColor"
                strokeOpacity={lane.key === "live" ? 0.7 : 0.35}
              />
            ))}
            <circle cx={inset} cy={middle(row.get("main")!)} r={3.5} fill="currentColor" />
            {props.mainAhead ? (
              <line
                x1={inset}
                x2={width - inset}
                y1={middle(row.get("main")!)}
                y2={middle(row.get("main")!)}
                stroke="currentColor"
                strokeDasharray="2 3"
              />
            ) : null}
            {steps.map((step, index) => {
              const own = row.get(authorKey(step.author)) ?? row.get("main")!;
              const selected = step.id === props.selected;
              const tone =
                step.author.id === mainAuthor.id ? null : personTone(step.author.ownerId);
              const select = () => props.onSelect(step.id);
              return (
                <g key={step.id} className={tone ? itemToneClass(tone) : undefined}>
                  <line
                    x1={x(index)}
                    x2={x(index)}
                    y1={middle(liveRow)}
                    y2={middle(own)}
                    stroke="currentColor"
                    strokeOpacity={0.5}
                  />
                  {[liveRow, own].map((at) => (
                    <Tooltip key={at} content={step.summary}>
                      <circle
                        cx={x(index)}
                        cy={middle(at)}
                        r={selected ? 5 : 3.5}
                        fill="currentColor"
                        stroke={selected ? "currentColor" : "none"}
                        strokeOpacity={0.35}
                        strokeWidth={selected ? 4 : 0}
                        role="button"
                        tabIndex={at === own ? 0 : -1}
                        aria-label={step.summary}
                        aria-pressed={selected}
                        className="cursor-pointer outline-none"
                        onClick={select}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            select();
                          }
                        }}
                      />
                    </Tooltip>
                  ))}
                </g>
              );
            })}
          </svg>
        </Text>
      </div>
    </div>
  );
}
