import type { ReactNode } from "react";
import { X, type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface DesktopSettingsNavEntry<Id extends string = string> {
  id: Id;
  label: string;
  icon: LucideIcon;
}

interface DesktopSettingsFrameProps<Id extends string> {
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

/**
 * The website counterpart to Misty's desktop settings frame. Its desktop
 * measurements intentionally match the app; only the narrowest web layout
 * collapses labels so the content remains usable on a phone.
 */
export function DesktopSettingsFrame<Id extends string>({
  activeId,
  ariaLabel,
  children,
  description,
  items,
  navigationLabel,
  navigationTitle,
  onClose,
  onSelect,
  presentation = "page",
  title,
}: DesktopSettingsFrameProps<Id>) {
  const overlay = presentation === "overlay";
  const activeItem = items.find((item) => item.id === activeId) ?? items[0];
  const ActiveIcon = activeItem?.icon;

  return (
    <div
      aria-label={ariaLabel}
      className={cn(
        "account-settings grid min-h-0 min-w-0",
        overlay ? "h-full" : "h-[calc(100dvh-4rem)]",
        "grid-cols-[216px_1px_minmax(0,1fr)] overflow-hidden bg-background",
        "max-[900px]:grid-cols-[184px_1px_minmax(0,1fr)]",
        "max-[680px]:grid-cols-[156px_1px_minmax(0,1fr)]",
        "max-[520px]:grid-cols-[64px_1px_minmax(0,1fr)]",
      )}
    >
      <aside className="min-h-0 overflow-y-auto bg-sidebar p-4 text-sidebar-foreground max-[680px]:px-2.5 max-[520px]:px-2">
        <nav aria-label={navigationLabel} className="flex min-h-0 flex-col gap-4">
          <div className="grid gap-1">
            <div className="px-2 pb-1 text-[11px] font-medium text-muted-foreground max-[520px]:sr-only">
              {overlay ? navigationLabel : navigationTitle}
            </div>
            {items.map((item) => {
              const Icon = item.icon;
              const active = item.id === activeId;

              return (
                <Button
                  key={item.id}
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-current={active ? "page" : undefined}
                  aria-label={item.label}
                  title={item.label}
                  onClick={() => onSelect(item.id)}
                  className={cn(
                    "h-9 w-full justify-start gap-2.5 rounded-md px-2.5 text-sm font-medium",
                    "text-muted-foreground shadow-none hover:bg-accent hover:text-accent-foreground",
                    "max-[520px]:justify-center max-[520px]:px-0",
                    active &&
                      "bg-sidebar-accent text-sidebar-accent-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  )}
                >
                  <span className="flex size-4 shrink-0 items-center justify-center [&>svg]:size-4">
                    <Icon aria-hidden="true" strokeWidth={1.8} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-left max-[520px]:sr-only">
                    {item.label}
                  </span>
                </Button>
              );
            })}
          </div>
        </nav>
      </aside>

      <div aria-hidden="true" className="bg-border" />

      <main className="flex min-h-0 min-w-0 flex-col bg-background">
        <header className="shrink-0 border-b border-border/60 bg-background">
          <div className="flex min-h-14 min-w-0 items-center gap-3 px-6 py-2 max-[720px]:px-4">
            {ActiveIcon ? (
              <div className="flex shrink-0 items-center text-muted-foreground">
                <ActiveIcon aria-hidden="true" className="size-4" strokeWidth={1.8} />
              </div>
            ) : null}
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-baseline gap-3">
                <h1 className="min-w-0 truncate text-base font-semibold leading-6 tracking-[-0.01em] text-foreground">
                  {title}
                </h1>
                {description ? (
                  <p className="min-w-0 truncate text-xs text-muted-foreground max-[760px]:hidden">
                    {description}
                  </p>
                ) : null}
              </div>
            </div>
            {overlay ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Close ${ariaLabel.toLowerCase()}`}
                onClick={onClose}
                className="shrink-0"
              >
                <X aria-hidden="true" className="size-4" strokeWidth={1.8} />
              </Button>
            ) : null}
          </div>
        </header>

        <div
          className={cn(
            "mx-auto min-h-0 w-full flex-1 overflow-y-auto overscroll-contain p-6 max-[720px]:p-4",
            overlay ? "max-w-[768px]" : "max-w-[1024px]",
          )}
        >
          {children}
        </div>
      </main>
    </div>
  );
}

export function DesktopSettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-7 min-w-0 last:mb-0">
      <div className="flex min-w-0 items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold leading-5 text-foreground">{title}</h2>
          {description ? (
            <p className="mt-1 max-w-2xl text-sm leading-5 text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
      </div>
      <div className="mt-4 overflow-hidden rounded-lg border border-border bg-card">
        {children}
      </div>
    </section>
  );
}

export function DesktopSettingsRow({
  label,
  description,
  children,
  last,
  muted,
}: {
  label: string;
  description?: string;
  children: ReactNode;
  last?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={cn(
        "grid min-h-16 grid-cols-[minmax(0,0.52fr)_minmax(240px,0.48fr)] items-center gap-5 border-b border-border px-5 py-3.5 last:border-b-0",
        "max-[760px]:grid-cols-1 max-[760px]:items-start max-[760px]:gap-3",
        "max-[520px]:grid-cols-1",
        last && "border-b-0",
        muted && "opacity-50",
      )}
    >
      <div className="grid min-w-0 gap-1">
        <strong className="text-sm font-medium leading-5 text-foreground">{label}</strong>
        {description ? (
          <span className="text-sm leading-5 text-muted-foreground">{description}</span>
        ) : null}
      </div>
      <div className="flex min-w-0 items-center justify-end max-[760px]:w-full max-[760px]:justify-start">
        {children}
      </div>
    </div>
  );
}
