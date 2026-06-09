import NoteBlock from "./NoteBlock";
import type { SectionData } from "./types";

function proseParagraphs(prose: string) {
  return prose
    .split(/\n\s*\n/g)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

export default function SectionBody({ section }: { section: SectionData }) {
  return (
    <>
      <h1 className="mb-6 text-[26.5px] font-bold text-text">
        {section.title}
      </h1>
      <div
        id={`${section.id}-overview`}
        className="flex flex-col gap-4 text-[16px] leading-relaxed text-text-secondary scroll-mt-20"
      >
        {proseParagraphs(section.prose).map((paragraph, index) => (
          <p key={index}>{paragraph}</p>
        ))}
      </div>

      {section.steps && (
        <div className="mt-10 flex flex-col gap-10">
          {section.steps.map((step, index) => (
            <div
              key={index}
              id={`${section.id}-step-${index}`}
              className="scroll-mt-20"
            >
              <div className="mb-4 flex items-start gap-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-xs font-bold text-text">
                  {index + 1}
                </span>
                <div>
                  <h3 className="mb-1 text-sm font-semibold text-text">
                    {step.heading}
                  </h3>
                  <p className="text-[17.5px] leading-relaxed text-text-secondary">
                    {step.text}
                  </p>
                </div>
              </div>
              {step.screenshot !== undefined &&
                (step.screenshot === null ? (
                  <div className="flex h-52 w-full items-center justify-center rounded-xl border border-dashed border-border bg-surface/40">
                    <span className="text-xs text-text-muted">
                      Screenshot - {step.heading}
                    </span>
                  </div>
                ) : (
                  <img
                    src={step.screenshot}
                    alt={step.heading}
                    className="block w-full rounded-xl border border-border"
                  />
                ))}
            </div>
          ))}
        </div>
      )}

      <div className="mt-8 flex flex-col gap-4">
        {section.notes.map((note, index) => (
          <div
            key={`${note.kind}-${index}`}
            id={`${section.id}-${note.kind}`}
            className="scroll-mt-20"
          >
            <NoteBlock kind={note.kind} text={note.text} />
          </div>
        ))}
      </div>
    </>
  );
}
