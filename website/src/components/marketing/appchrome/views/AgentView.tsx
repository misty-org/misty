import { cn } from "@/lib/utils";
import { AppChip } from "../AppWindow";

const context = [
  { source: "Launch plan · conversations", access: "Permitted" },
  { source: "Launch plan · Library", access: "Permitted" },
  { source: "Launch plan · tasks", access: "Permitted" },
  { source: "Your private files", access: "Excluded" },
  { source: "Other Spaces", access: "Excluded" },
];

/**
 * A custom Agent answering from Space context.
 *
 * The permissions table is the argument: the Agent reads the Space and
 * nothing else, and the two "Excluded" rows are what make that legible.
 */
export function AgentView() {
  return (
    <>
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--app-border)] px-3">
        <span className="grid size-5 place-items-center rounded-full bg-[var(--app-ink-bright)] text-[9px] font-semibold text-[var(--app-bg)]">
          MK
        </span>
        <span className="text-[12px] font-medium text-[var(--app-ink-bright)]">
          Launch assistant
        </span>
        <AppChip>Model routing · Automatic</AppChip>
      </div>

      <div className="grid min-h-0 flex-1 @xl:grid-cols-[minmax(0,1fr)_212px]">
        <div className="flex min-w-0 flex-col justify-end gap-3 p-4">
          <div className="ml-auto max-w-[80%] rounded-xl rounded-br-md bg-[var(--app-ink-bright)] px-3 py-2 text-[13px] leading-[1.5] text-[var(--app-bg)]">
            What still needs a decision before launch?
          </div>
          <div className="max-w-[88%] rounded-xl rounded-bl-md border border-[var(--app-border)] bg-[var(--app-card)] px-3 py-2 text-[13px] leading-[1.5] text-[var(--app-ink)]">
            The release date has no owner. Everything else in the brief is
            assigned — onboarding went to Alex this morning.
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-[var(--app-border)] bg-[var(--app-card)] px-3 py-2.5">
            <span className="text-[13px] text-[var(--app-ink-muted)]">
              Ask Launch assistant
            </span>
          </div>
        </div>

        <div className="hidden flex-col border-l border-[var(--app-border)] bg-[var(--app-sidebar)] p-3 @xl:flex">
          <p className="text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--app-ink-muted)]">
            Context
          </p>
          <div className="mt-2.5 space-y-1.5">
            {context.map(({ source, access }) => (
              <div key={source} className="flex items-center gap-2">
                <span
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    access === "Permitted"
                      ? "bg-[#28c840]"
                      : "bg-[var(--app-active)]",
                  )}
                />
                <span
                  className={cn(
                    "truncate text-[10.5px] leading-snug",
                    access === "Permitted"
                      ? "text-[var(--app-ink)]"
                      : "text-[var(--app-ink-muted)]",
                  )}
                >
                  {source}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
