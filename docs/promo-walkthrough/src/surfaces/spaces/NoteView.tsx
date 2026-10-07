import { Check, ChevronRight, Ellipsis, UsersRound } from "lucide-react";
import { brief, sharedNote } from "../../data/project";

function Header({ space, title, shared }: { space: string; title: string; shared?: boolean }) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-1.5 border-b border-charcoal-border px-6 text-sm text-cream-muted">
      <span>{space}</span>
      <ChevronRight className="size-3.5" aria-hidden />
      <span>Journal</span>
      <ChevronRight className="size-3.5" aria-hidden />
      <span className="text-cream">{title}</span>
      <span className="ml-auto flex items-center gap-3">
        {shared && (
          <span className="flex items-center gap-1.5 text-xs">
            <UsersRound className="size-3.5" aria-hidden /> 4 members
          </span>
        )}
        <span className="flex items-center gap-1 text-xs">
          Saved <Check className="size-3" aria-hidden />
        </span>
        <Ellipsis className="size-4" aria-hidden />
      </span>
    </div>
  );
}

export function BriefNote() {
  return (
    <div className="flex h-full flex-col bg-[#101010]">
      <Header space="Personal" title={brief.title} />
      <article className="mx-auto w-full max-w-[720px] px-8 pt-12 text-cream" data-t="brief-body">
        <h1 className="text-[34px] font-semibold tracking-tight text-cream-bright">{brief.title}</h1>
        <p className="mt-2 text-sm text-cream-muted">{brief.meta}</p>
        <p className="mt-7 text-[16px] leading-relaxed">{brief.goal}</p>
        <h2 className="mt-8 text-[20px] font-semibold text-cream-bright">Pages</h2>
        <ul className="mt-3 list-disc space-y-1.5 pl-6 text-[16px] marker:text-cream-muted">
          {brief.pages.map((page) => (
            <li key={page}>{page}</li>
          ))}
        </ul>
        <h2 className="mt-8 text-[20px] font-semibold text-cream-bright">Requirements</h2>
        <ul className="mt-3 space-y-2.5 text-[16px]" data-t="brief-requirements">
          {brief.requirements.map((line, index) => (
            <li key={line} className="flex items-center gap-3">
              <span className="grid size-[18px] shrink-0 place-items-center rounded-[5px] border border-cream-muted">
                {index === 0 && <Check className="size-3" aria-hidden />}
              </span>
              <span className={index === 0 ? "text-cream-muted line-through" : undefined}>{line}</span>
            </li>
          ))}
        </ul>
        <p className="mt-8 text-[15px] text-cream-muted">{brief.date}</p>
      </article>
    </div>
  );
}

export function SharedNote({ addition = "", caret }: { addition?: string; caret?: boolean }) {
  return (
    <div className="flex h-full flex-col bg-[#101010]">
      <Header space="Website launch" title={sharedNote.title} shared />
      <article className="mx-auto w-full max-w-[720px] px-8 pt-12 text-cream" data-t="shared-body">
        <h1 className="text-[34px] font-semibold tracking-tight text-cream-bright">{sharedNote.title}</h1>
        <p className="mt-2 text-sm text-cream-muted">{sharedNote.meta}</p>
        {sharedNote.lines.map((line) =>
          line.kind === "h2" ? (
            <h2 key={line.text} className="mt-8 text-[20px] font-semibold text-cream-bright">
              {line.text}
            </h2>
          ) : (
            <p key={line.text} className="mt-3 text-[16px] leading-relaxed">
              {line.text}
            </p>
          ),
        )}
        <p className="mt-3 min-h-7 text-[16px] leading-relaxed" data-t="shared-addition">
          {addition}
          {caret && <span className="ml-px inline-block h-[18px] w-px translate-y-[3px] bg-cream-bright" />}
        </p>
      </article>
    </div>
  );
}
