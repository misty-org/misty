import type { ReactNode } from "react";
import { type LucideIcon, X } from "lucide-react";
import { Button, cn } from "@/ui";

export function DesktopSettingsFrame<Id extends string>(props: DesktopSettingsFrameProps<Id>) {
  const overlay = props.presentation === "overlay";
  const activeItem = props.items.find((item) => item.id === props.activeId) ?? props.items[0];
  const ActiveIcon = activeItem?.icon;

  return (
    <div
      aria-label={props.ariaLabel}
      className={cn(
        "grid min-h-0 min-w-0 grid-cols-[216px_1px_minmax(0,1fr)] overflow-hidden bg-charcoal-bg",
        overlay ? "h-full" : "h-screen",
        "max-[900px]:grid-cols-[184px_1px_minmax(0,1fr)]",
        "max-[680px]:grid-cols-[156px_1px_minmax(0,1fr)]",
      )}
    >
      <aside
        className={cn(
          "min-h-0 overflow-y-auto bg-charcoal-sidebar p-4 text-cream-muted",
          "max-[680px]:px-2.5",
          "",
        )}
      >
        <nav className="flex min-h-0 flex-col gap-4" aria-label={props.navigationLabel}>
          <div className="grid gap-1">
            <div className="px-2 pb-1 text-[11px] font-medium text-cream-muted">
              {overlay ? props.navigationLabel : props.navigationTitle}
            </div>
            {props.items.map((item) => {
              const Icon = item.icon;
              const active = props.activeId === item.id;
              return (
                <Button
                  key={item.id}
                  type="button"
                  variant="ghost"
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "h-10 w-full justify-start gap-3 px-3 text-sm font-medium",
                    active
                      ? "bg-charcoal-active text-cream-bright"
                      : "text-cream-muted hover:bg-charcoal-hover hover:text-cream",
                  )}
                  onClick={() => props.onSelect(item.id)}
                >
                  <span className="grid size-4 shrink-0 place-items-center">
                    <Icon className="size-4" strokeWidth={1.8} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
                </Button>
              );
            })}
          </div>
        </nav>
      </aside>

      <div aria-hidden="true" className="bg-charcoal-border" />

      <main className="flex min-h-0 min-w-0 flex-col bg-charcoal-bg">
        <header className="shrink-0 border-b border-charcoal-border/60 bg-charcoal-bg">
          <div className="flex min-h-14 min-w-0 items-center gap-3 px-6 py-2 max-[720px]:px-4">
            {ActiveIcon ? (
              <div className="flex shrink-0 items-center text-cream-muted">
                <ActiveIcon className="size-4" strokeWidth={1.8} />
              </div>
            ) : null}
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-baseline gap-3">
                <h1 className="min-w-0 truncate text-base font-semibold leading-6 text-cream">
                  {props.title}
                </h1>
                {props.description ? (
                  <p className="min-w-0 truncate text-xs text-cream-muted max-[760px]:hidden">
                    {props.description}
                  </p>
                ) : null}
              </div>
            </div>
            {overlay ? (
              <Button
                aria-label={`Close ${props.ariaLabel.toLowerCase()}`}
                size="icon"
                type="button"
                variant="ghost"
                onClick={props.onClose}
              >
                <X className="size-4" strokeWidth={1.8} />
              </Button>
            ) : null}
          </div>
        </header>
        <div
          className={cn(
            "misty-scrollbar min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain p-6 max-[720px]:p-4",
            "mx-auto w-full",
            overlay ? "max-w-3xl" : "max-w-5xl",
          )}
        >
          {props.children}
        </div>
      </main>
    </div>
  );
}

export function DesktopSettingsSection(props: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-7 min-w-0 last:mb-0">
      <div className="mb-4 min-w-0">
        <h2 className="text-sm font-semibold leading-5 text-cream">{props.title}</h2>
        {props.description ? (
          <p className="mt-1 max-w-2xl text-sm leading-5 text-cream-muted">{props.description}</p>
        ) : null}
      </div>
      <div className="overflow-hidden rounded-lg border border-charcoal-border bg-charcoal-card">
        {props.children}
      </div>
    </section>
  );
}

export function DesktopSettingsRow(props: {
  label: string;
  description?: string;
  children: ReactNode;
  last?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={cn(
        "grid min-h-16 grid-cols-[minmax(0,0.52fr)_minmax(240px,0.48fr)] items-center gap-5 border-b border-charcoal-border px-5 py-3.5 last:border-b-0",
        "max-[760px]:grid-cols-1 max-[760px]:items-start max-[760px]:gap-3",
        props.last && "border-b-0",
        props.muted && "opacity-50",
      )}
    >
      <div className="grid min-w-0 gap-1">
        <strong className="text-sm font-medium leading-5 text-cream">{props.label}</strong>
        {props.description ? (
          <span className="text-sm leading-5 text-cream-muted">{props.description}</span>
        ) : null}
      </div>
      <div className="flex min-w-0 items-center justify-end max-[760px]:w-full max-[760px]:justify-start">
        {props.children}
      </div>
    </div>
  );
}

export interface DesktopSettingsNavEntry<Id extends string = string> {
  id: Id;
  label: string;
  icon: LucideIcon;
}

export interface DesktopSettingsFrameProps<Id extends string> {
  activeId: Id;
  ariaLabel: string;
  children: ReactNode;
  description?: ReactNode;
  items: readonly DesktopSettingsNavEntry<Id>[];
  navigationLabel: string;
  navigationTitle: string;
  onClose?: () => void;
  onSelect: (id: Id) => void;
  presentation?: "page" | "overlay";
  title: ReactNode;
}
