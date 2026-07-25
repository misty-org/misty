import { publicPageContainer } from "@/components/marketing";
import { connections } from "../data";

export function Connections() {
  return (
    <section
      aria-label="Connections"
      className="border-b border-border py-14 sm:py-16"
    >
      <div
        className={`${publicPageContainer} grid gap-10 lg:grid-cols-[0.9fr_2.1fr] lg:items-center lg:gap-16`}
      >
        <div className="max-w-sm">
          <h2 className="text-balance text-xl font-medium tracking-[-0.02em] text-foreground">
            Works with the tools your group already uses.
          </h2>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Connections are rolling out through the beta. Current status is
            listed for each.
          </p>
        </div>
        <ul className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-4">
          {connections.map(({ name, Mark, status }) => (
            <li key={name} className="flex flex-col gap-3">
              <Mark className="size-7 text-foreground/75" aria-hidden="true" />
              <div>
                <p className="text-sm font-medium text-foreground">{name}</p>
                <p className="mt-1 text-xs text-muted-foreground">{status}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
