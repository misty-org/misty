import { mistyRoadmapUrl } from "@/shared/ui/coming-soon-surface";
import { KeyRound, Puzzle, ShieldBan, BookOpenText, Code2, type LucideIcon } from "lucide-react";
import { DiscoverCard } from "@/shared/ui";
import { InternalPageFrame } from "./InternalPageFrame";

const previews: { icon: LucideIcon; title: string; detail: string }[] = [
  { icon: ShieldBan, title: "Content blockers", detail: "Block ads, trackers and distractions." },
  { icon: KeyRound, title: "Password managers", detail: "Fill sign-ins from the manager you use." },
  { icon: BookOpenText, title: "Reading tools", detail: "Reader views, translation and highlights." },
  { icon: Code2, title: "Developer tools", detail: "Inspect, debug and tweak websites." },
];

/** Extensions are planned; this page says so plainly instead of pretending. */
export function ExtensionsPage() {
  return (
    <InternalPageFrame title="Extensions" icon={Puzzle}>
      <section className="py-6 text-center">
        <p className="text-xs font-medium uppercase tracking-[0.08em] text-cream-muted">
          Coming soon
        </p>
        <h2 className="mt-2 text-xl font-semibold tracking-[-0.02em] text-cream-bright">
          Extensions are coming to Misty
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-cream-muted">
          Misty will support Safari web extensions on macOS 15.4 and later. Nothing can be
          installed yet; these are the kinds of extensions we plan to support first.
        </p>
      </section>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {previews.map(({ icon: Icon, title, detail }) => (
          <li key={title}>
            <DiscoverCard className="h-full p-4">
            <span className="grid size-8 place-items-center rounded-lg bg-charcoal-workspace text-cream-bright">
              <Icon size={16} aria-hidden="true" />
            </span>
            <p className="mt-3 text-sm font-medium text-cream-bright">{title}</p>
            <p className="mt-1 text-xs text-cream-muted">{detail}</p>
            <span className="absolute right-3 top-3 rounded-full bg-charcoal-workspace px-2 py-0.5 text-[10px] text-cream-muted">
              Preview
            </span>
            </DiscoverCard>
          </li>
        ))}
      </ul>
      <a
        className="mx-auto mt-8 block w-fit text-xs text-cream-muted underline underline-offset-4 hover:text-cream-bright"
        href={mistyRoadmapUrl}
        target="_blank"
        rel="noreferrer"
      >
        View the Misty roadmap
      </a>
    </InternalPageFrame>
  );
}
