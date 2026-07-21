import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function ProductFrame({
  title,
  meta,
  children,
  className,
}: {
  title: string;
  meta?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-border bg-card shadow-sm",
        className,
      )}
    >
      <div className="flex h-12 items-center justify-between border-b border-border px-4 sm:px-5">
        <div className="flex items-center gap-2.5">
          <span className="size-2 rounded-full bg-foreground/25" aria-hidden="true" />
          <span className="text-sm font-medium text-foreground">{title}</span>
        </div>
        {meta ? <span className="text-xs text-muted-foreground">{meta}</span> : null}
      </div>
      {children}
    </div>
  );
}

export function ProductScreenshot({
  src,
  alt,
  label,
  eager = false,
  className,
}: {
  src: string;
  alt: string;
  label: string;
  eager?: boolean;
  className?: string;
}) {
  return (
    <figure className={className}>
      <div className="overflow-hidden rounded-2xl border border-border bg-zinc-950 p-1.5 shadow-xl shadow-foreground/10 sm:p-2">
        <div className="aspect-[16/10] overflow-hidden rounded-xl bg-zinc-950">
          <img
            src={src}
            alt={alt}
            className="h-full w-full object-cover object-top"
            width="1600"
            height="1000"
            loading={eager ? "eager" : "lazy"}
            fetchPriority={eager ? "high" : "auto"}
            decoding="async"
          />
        </div>
      </div>
      <figcaption className="mt-3 text-xs text-muted-foreground">{label}</figcaption>
    </figure>
  );
}

export function ChatPreview() {
  const messages = [
    {
      initials: "AM",
      name: "Alex",
      text: "The launch brief is ready. I marked the two open decisions.",
    },
    {
      initials: "JR",
      name: "Jordan",
      text: "I’ll take onboarding. Can we confirm the release date today?",
    },
  ];

  return (
    <ProductFrame title="Launch plan" meta="4 members">
      <div className="grid min-h-[22rem] sm:grid-cols-[10rem_1fr]">
        <div className="hidden border-r border-border bg-muted/25 p-3 sm:block">
          <p className="px-2 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Conversations
          </p>
          {["Everyone", "Design", "Release"].map((channel, index) => (
            <div
              key={channel}
              className={cn(
                "mt-1 rounded-lg px-3 py-2 text-xs",
                index === 0 ? "bg-background font-medium text-foreground shadow-xs" : "text-muted-foreground",
              )}
            >
              {channel}
            </div>
          ))}
        </div>
        <div className="flex min-w-0 flex-col p-4 sm:p-5">
          <div className="flex-1 space-y-5">
            {messages.map((message) => (
              <div key={message.name} className="flex gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground text-[10px] font-semibold text-background">
                  {message.initials}
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-foreground">{message.name}</p>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">{message.text}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-6 rounded-xl border border-border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
            Message this Space
          </div>
        </div>
      </div>
    </ProductFrame>
  );
}

export function TasksPreview() {
  const columns = [
    {
      title: "To do",
      tasks: [
        ["Confirm release date", "High"],
        ["Review launch brief", "Medium"],
      ],
    },
    {
      title: "In progress",
      tasks: [["Draft onboarding", "Medium"]],
    },
    {
      title: "Done",
      tasks: [["Collect research", "Done"]],
    },
  ];

  return (
    <ProductFrame title="Launch plan" meta="Tasks · Board">
      <div
        role="region"
        aria-label="Task board preview"
        tabIndex={0}
        className="overflow-x-auto p-4 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:p-5"
      >
        <div className="grid min-h-[20rem] min-w-[32rem] grid-cols-3 gap-3">
          {columns.map((column, columnIndex) => (
            <div key={column.title} className="rounded-xl border border-border bg-muted/25 p-3">
              <div className="mb-4 flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground">
                  {column.title}
                </p>
                <span className="text-xs text-muted-foreground">{column.tasks.length}</span>
              </div>
              <div className="space-y-2">
                {column.tasks.map(([task, priority]) => (
                  <div key={task} className="rounded-lg border border-border bg-background p-3 shadow-xs">
                    <p className="text-xs font-medium text-foreground">{task}</p>
                    <div className="mt-5 flex items-center justify-between text-[10px] text-muted-foreground">
                      <span>{priority}</span>
                      <span>{columnIndex === 2 ? "Completed" : "Jul 24"}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </ProductFrame>
  );
}

export function ConnectionsPreview() {
  const connections = [
    ["Google Calendar", "Pilot"],
    ["Slack", "Coming"],
    ["Notion", "Coming"],
    ["Discord", "Coming"],
  ];

  return (
    <ProductFrame title="Connections" meta="Beta preview">
      <div className="min-h-80 p-4 sm:p-6">
        <div className="mb-5 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          Search connections
        </div>
        <div className="divide-y divide-border rounded-xl border border-border">
          {connections.map(([name, status]) => (
            <div key={name} className="flex items-center justify-between gap-4 px-4 py-4">
              <span className="text-sm font-medium text-foreground">{name}</span>
              <span className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground">
                {status}
              </span>
            </div>
          ))}
        </div>
      </div>
    </ProductFrame>
  );
}

export function MikaPreview() {
  return (
    <ProductFrame title="Mika" meta="Conditional beta">
      <div className="flex min-h-80 flex-col justify-end gap-4 p-4 sm:p-6">
        <div className="ml-auto max-w-[82%] rounded-2xl rounded-br-md bg-foreground px-4 py-3 text-sm leading-6 text-background">
          What still needs a decision before launch?
        </div>
        <div className="max-w-[90%] rounded-2xl rounded-bl-md border border-border bg-muted/35 px-4 py-3 text-sm leading-6 text-foreground/80">
          The release date and onboarding owner are still open in the launch brief.
        </div>
        <div className="flex flex-wrap gap-2 border-t border-border pt-4 text-xs text-muted-foreground">
          <span className="rounded-full border border-border px-2.5 py-1">Private conversation</span>
          <span className="rounded-full border border-border px-2.5 py-1">Permitted context</span>
        </div>
      </div>
    </ProductFrame>
  );
}

export function FilesPreview() {
  const files = [
    ["Launch brief.pdf", "2.4 MB", "Local"],
    ["Research notes.md", "18 KB", "Connected"],
    ["Brand assets", "Folder", "Local"],
    ["Interview clips", "Folder", "Connected"],
  ];

  return (
    <ProductFrame title="Files" meta="Private to you">
      <div className="grid min-h-[22rem] sm:grid-cols-[10rem_1fr]">
        <div className="hidden border-r border-border bg-muted/25 p-3 sm:block">
          <p className="px-2 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Locations
          </p>
          {["Local", "Connected", "Recent"].map((location, index) => (
            <div
              key={location}
              className={cn(
                "mt-1 rounded-lg px-3 py-2 text-xs",
                index === 0 ? "bg-background font-medium text-foreground shadow-xs" : "text-muted-foreground",
              )}
            >
              {location}
            </div>
          ))}
        </div>
        <div className="min-w-0 p-4 sm:p-5">
          <div className="mb-4 rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
            Search Files
          </div>
          <div className="divide-y divide-border rounded-xl border border-border">
            {files.map(([name, size, source]) => (
              <div key={name} className="grid grid-cols-[1fr_auto] gap-4 px-4 py-3 sm:grid-cols-[1fr_5rem_5rem]">
                <span className="truncate text-xs font-medium text-foreground">{name}</span>
                <span className="hidden text-xs text-muted-foreground sm:block">{size}</span>
                <span className="text-right text-xs text-muted-foreground">{source}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </ProductFrame>
  );
}
