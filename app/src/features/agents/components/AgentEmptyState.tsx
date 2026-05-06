import {
  Bot,
  Code,
  FolderOpen,
  MessageCircle,
  Notebook,
  Pencil,
  Plus,
  Search,
  Wrench,
} from "lucide-react";
import type { ComponentType } from "react";

interface Template {
  name: string;
  icon: ComponentType<{ size?: number }>;
  description: string;
}

const TEMPLATES: Template[] = [
  {
    name: "Research assistant",
    icon: Search,
    description: "Reads library docs, cites sources, drafts a brief.",
  },
  {
    name: "PR reviewer",
    icon: Code,
    description: "Checks diffs against your style guide and flags risks.",
  },
  {
    name: "Meeting notetaker",
    icon: Notebook,
    description: "Turns transcripts into decisions, owners, and next steps.",
  },
  {
    name: "Content editor",
    icon: Pencil,
    description: "Tightens drafts in your voice, keeps facts intact.",
  },
];

interface Capability {
  icon: ComponentType<{ size?: number }>;
  title: string;
  description: string;
}

const CAPABILITIES: Capability[] = [
  {
    icon: MessageCircle,
    title: "Live in Spaces",
    description: "Chat, planner, and members.",
  },
  {
    icon: FolderOpen,
    title: "Reads your context",
    description: "Library, notes, tasks — you choose.",
  },
  {
    icon: Wrench,
    title: "Uses tools",
    description: "Grant only the actions it needs.",
  },
];

export function AgentEmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <section
      aria-label="Get started with agents"
      className="misty-transient-scrollbar min-h-0 overflow-y-auto"
    >
      <div className="mx-auto grid max-w-2xl gap-7 px-10 py-8">
        <header className="flex items-start gap-4">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl border border-charcoal-border bg-charcoal-card text-cream">
            <Bot size={21} />
          </span>
          <div>
            <h1 className="m-0 text-xl font-medium text-cream-bright">
              Build an agent for repeat work
            </h1>
            <p className="mb-0 mt-1.5 text-[13px] leading-[1.55] text-cream-muted">
              Agents keep instructions, a model, and tool access in one place — reuse them
              across every Space you invite them into.
            </p>
          </div>
        </header>

        <div>
          <div className="mb-3 text-[11px] font-medium uppercase tracking-wider text-cream-muted">
            Start from a template
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            {TEMPLATES.map((t) => (
              <button
                key={t.name}
                type="button"
                onClick={onCreate}
                className="flex flex-col items-start gap-2 rounded-xl border border-charcoal-border bg-charcoal-card p-3.5 text-left hover:bg-charcoal-hover"
              >
                <div className="flex items-center gap-2.5">
                  <span className="grid size-7 place-items-center rounded-md border border-charcoal-border bg-charcoal-bg text-cream">
                    <t.icon size={15} />
                  </span>
                  <span className="text-[13px] font-medium text-cream-bright">
                    {t.name}
                  </span>
                </div>
                <p className="m-0 text-xs leading-[1.5] text-cream-muted">
                  {t.description}
                </p>
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={onCreate}
          className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-charcoal-hover px-3.5 py-3 text-left hover:bg-charcoal-card"
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid size-6 shrink-0 place-items-center rounded-md border border-charcoal-border bg-charcoal-card text-cream-muted">
              <Plus size={13} />
            </span>
            <span className="truncate text-[12.5px] text-cream">
              Start from scratch — pick a name and instructions
            </span>
          </div>
          <span className="shrink-0 text-[11.5px] text-cream-muted">Blank agent →</span>
        </button>

        <div className="grid grid-cols-3 gap-2.5">
          {CAPABILITIES.map((c) => (
            <div
              key={c.title}
              className="rounded-lg border border-charcoal-border bg-charcoal-sidebar px-3 py-2.5"
            >
              <div className="flex items-center gap-2 text-[11.5px] font-medium text-cream-bright">
                <c.icon size={14} />
                {c.title}
              </div>
              <p className="mb-0 mt-1 text-[11px] leading-[1.5] text-cream-muted">
                {c.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
