import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import {
  IconButton,
  PageBody,
  PageHeader,
  PageShell,
  Section,
  SidebarNav,
  SidebarNavItem,
  SidebarNavSection,
} from "@/components/misty";
import { X } from "lucide-react";
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

export function DesktopSettingsFrame<Id extends string>(
  props: DesktopSettingsFrameProps<Id>,
) {
  const overlay = props.presentation === "overlay";
  const activeItem =
    props.items.find((item) => item.id === props.activeId) ?? props.items[0];
  const ActiveIcon = activeItem?.icon;

  return (
    <PageShell
      aria-label={props.ariaLabel}
      className={cn(
        "grid min-h-0 min-w-0 grid-cols-[216px_1px_minmax(0,1fr)] overflow-hidden bg-background",
        overlay ? "h-full" : "h-screen",
        "max-[900px]:grid-cols-[184px_1px_minmax(0,1fr)]",
        "max-[680px]:grid-cols-[156px_1px_minmax(0,1fr)]",
      )}
    >
      <aside className="min-h-0 overflow-y-auto bg-sidebar p-4 text-sidebar-foreground max-[680px]:px-2.5">
        <SidebarNav label={props.navigationLabel}>
          <SidebarNavSection
            label={overlay ? props.navigationLabel : props.navigationTitle}
          >
            {props.items.map((item) => {
              const Icon = item.icon;
              return (
                <SidebarNavItem
                  key={item.id}
                  active={props.activeId === item.id}
                  icon={<Icon strokeWidth={1.8} />}
                  onClick={() => props.onSelect(item.id)}
                >
                  {item.label}
                </SidebarNavItem>
              );
            })}
          </SidebarNavSection>
        </SidebarNav>
      </aside>

      <div aria-hidden="true" className="bg-border" />

      <main className="flex min-h-0 min-w-0 flex-col bg-background">
        <PageHeader
          title={props.title}
          description={props.description}
          leading={ActiveIcon ? <ActiveIcon className="size-4" strokeWidth={1.8} /> : null}
          actions={
            overlay ? (
              <IconButton
                label={`Close ${props.ariaLabel.toLowerCase()}`}
                tooltip={false}
                onClick={props.onClose}
              >
                <X className="size-4" strokeWidth={1.8} />
              </IconButton>
            ) : null
          }
        />
        <PageBody
          width="content"
          className={cn(
            "misty-scrollbar w-full",
            overlay ? "max-w-3xl" : "max-w-5xl",
          )}
        >
          {props.children}
        </PageBody>
      </main>
    </PageShell>
  );
}

export function DesktopSettingsSection(props: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Section
      title={props.title}
      description={props.description}
      className="mb-7 last:mb-0"
    >
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {props.children}
      </div>
    </Section>
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
        "grid min-h-16 grid-cols-[minmax(0,0.52fr)_minmax(240px,0.48fr)] items-center gap-5 border-b border-border px-5 py-3.5 last:border-b-0",
        "max-[760px]:grid-cols-1 max-[760px]:items-start max-[760px]:gap-3",
        props.last && "border-b-0",
        props.muted && "opacity-50",
      )}
    >
      <div className="grid min-w-0 gap-1">
        <strong className="text-sm font-medium leading-5 text-foreground">
          {props.label}
        </strong>
        {props.description ? (
          <span className="text-sm leading-5 text-muted-foreground">
            {props.description}
          </span>
        ) : null}
      </div>
      <div className="flex min-w-0 items-center justify-end max-[760px]:w-full max-[760px]:justify-start">
        {props.children}
      </div>
    </div>
  );
}
