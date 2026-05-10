import { cn } from "@/lib/utils";
import { AppChip } from "../AppWindow";

const sections = ["Chat", "Tasks", "Library", "Agents"];

// Enough of a conversation to fill the hero window. Narrower windows
// bottom-anchor and clip the earliest messages, which reads the way a
// scrolled chat pane should.
const messages = [
  {
    initials: "TL",
    name: "Taylor",
    time: "9:36",
    text: "Moved everything for the launch into this Space — the old thread is dead.",
  },
  {
    initials: "SK",
    name: "Sam",
    time: "9:39",
    text: "Adding the research notes and the competitive teardown to the Library.",
  },
  {
    initials: "JR",
    name: "Jordan",
    time: "9:41",
    text: "Brief's ready. Two decisions still open — release date and who owns onboarding.",
  },
  {
    initials: "AM",
    name: "Alex",
    time: "9:44",
    text: "I'll take onboarding. Pulling the research notes into the Library now.",
  },
  {
    initials: "MK",
    name: "Mika",
    time: "9:44",
    agent: true,
    text: "Release date is the only item without an owner. I've added it to the board.",
  },
];

const tasks = [
  { title: "Confirm release date", meta: "Unassigned", open: true },
  { title: "Draft onboarding", meta: "Alex · Jul 24", open: true },
  { title: "Collect research", meta: "Completed", open: false },
];

export function SpaceView() {
  return (
    <>
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-[var(--app-border)] px-3">
        {sections.map((section, index) => (
          <span
            key={section}
            className={cn(
              "rounded-md px-2.5 py-1 text-[12px]",
              index === 0
                ? "bg-[var(--app-hover)] font-medium text-[var(--app-ink-bright)]"
                : "text-[var(--app-ink-muted)]",
            )}
          >
            {section}
          </span>
        ))}
        <span className="ml-auto text-[11px] text-[var(--app-ink-muted)]">
          Launch plan
        </span>
      </div>

      <div className="grid min-h-0 flex-1 @xl:grid-cols-[minmax(0,1fr)_212px]">
        <div className="flex min-w-0 flex-col overflow-hidden p-4">
          <div className="flex flex-1 flex-col justify-end space-y-4">
            {messages.map((message) => (
              <div key={message.name} className="flex gap-2.5">
                <span
                  className={cn(
                    "grid size-7 shrink-0 place-items-center rounded-full text-[10px] font-semibold",
                    message.agent
                      ? "bg-[var(--app-ink-bright)] text-[var(--app-bg)]"
                      : "bg-[var(--app-active)] text-[var(--app-ink-bright)]",
                  )}
                >
                  {message.initials}
                </span>
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--app-ink-bright)]">
                    {message.name}
                    {message.agent ? <AppChip>Agent</AppChip> : null}
                    <span className="font-normal text-[var(--app-ink-muted)]">
                      {message.time}
                    </span>
                  </p>
                  <p className="mt-1 text-[13px] leading-[1.5] text-[var(--app-ink)]">
                    {message.text}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 flex items-center gap-2 rounded-lg border border-[var(--app-border)] bg-[var(--app-card)] px-3 py-2.5">
            <span className="text-[13px] text-[var(--app-ink-muted)]">
              Message Launch plan
            </span>
            <span className="ml-auto rounded-md bg-[var(--app-hover)] px-1.5 py-0.5 text-[10px] text-[var(--app-ink-muted)]">
              ⌘↵
            </span>
          </div>
        </div>

        <div className="hidden flex-col border-l border-[var(--app-border)] bg-[var(--app-sidebar)] p-3 @xl:flex">
          <p className="text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--app-ink-muted)]">
            Tasks
          </p>
          <div className="mt-2.5 space-y-1.5">
            {tasks.map((task) => (
              <div
                key={task.title}
                className="rounded-md border border-[var(--app-border)] bg-[var(--app-card)] px-2.5 py-2"
              >
                <p
                  className={cn(
                    "text-[11px] font-medium leading-snug",
                    task.open
                      ? "text-[var(--app-ink-bright)]"
                      : "text-[var(--app-ink-muted)] line-through",
                  )}
                >
                  {task.title}
                </p>
                <p className="mt-1.5 text-[10px] text-[var(--app-ink-muted)]">
                  {task.meta}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
