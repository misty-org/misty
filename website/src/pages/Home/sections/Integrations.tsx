import { connections } from "../data";
import { useReveal } from "@/hooks/useReveal";

export function Integrations() {
  const ref = useReveal<HTMLElement>();

  return (
    <section ref={ref} aria-label="Integrations" className="reveal py-3 sm:py-4">
      <div className="mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-12">
        <div className="overflow-hidden rounded-xl border border-[var(--marketing-border)] bg-[var(--marketing-surface)]">
          <div className="border-b border-[var(--marketing-border)] px-5 py-5 sm:px-6 sm:py-6">
            <h2 className="text-xl font-medium tracking-[-0.025em] text-[var(--marketing-foreground)] sm:text-2xl">
              Connect the tools your group already uses.
            </h2>
          </div>
          <div className="grid grid-cols-2 gap-px bg-[var(--marketing-border)] sm:grid-cols-4">
            {connections.map(({ name, Mark, status }) => (
              <div key={name} className="flex min-h-36 flex-col justify-between bg-[var(--marketing-surface)] p-5 sm:p-6">
                <Mark className="size-7 text-[var(--marketing-foreground)]" aria-hidden="true" />
                <div>
                  <p className="text-base font-medium text-[var(--marketing-foreground)]">{name}</p>
                  <p className="mt-1 text-sm text-[var(--marketing-muted)]">{status}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
