const examples = [
  { initial: "W", name: "Work", detail: "Work sign-ins, the team's notes and chat" },
  { initial: "S", name: "School", detail: "Classes, readings and group projects" },
  { initial: "F", name: "Family", detail: "Trips, photos and plans you share" },
];

const points = [
  "Each Space keeps its own tabs, sign-ins, history and memory, so work and home never mix.",
  "Your agents work inside a Space and only see what's in it.",
  "Invite people to a Space to make notes, drawings and files together and chat. Your sign-ins and memory stay yours.",
];

/** First-run setup's introduction to Spaces: three example Spaces and what a Space keeps apart. */
export function SpacesStep() {
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-3 gap-3" aria-hidden>
        {examples.map((space) => (
          <div
            key={space.name}
            className="rounded-lg border border-charcoal-border bg-charcoal-card p-3"
          >
            <span className="grid size-7 place-items-center rounded-md bg-charcoal-active text-xs text-cream-bright">
              {space.initial}
            </span>
            <p className="m-0 mt-2 text-sm text-cream-bright">{space.name}</p>
            <p className="m-0 mt-0.5 text-xs leading-snug text-cream-muted">{space.detail}</p>
          </div>
        ))}
      </div>
      <ul className="m-0 flex list-disc flex-col gap-2 pl-5 text-sm leading-relaxed text-cream">
        {points.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ul>
    </div>
  );
}
