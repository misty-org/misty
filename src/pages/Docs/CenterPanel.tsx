import type { Section, GuideSection, ApiSection } from "./data";
import { methodColor } from "./data";
import CodeBlock from "./CodeBlock";
import NoteBlock from "./NoteBlock";

function formatLabel(value: string) {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

export default function CenterPanel({
  section,
  sections,
  activeId,
  onSelect,
}: {
  section: Section;
  sections: Section[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  const currentIndex = sections.findIndex((item) => item.id === activeId);
  const previousSection = currentIndex > 0 ? sections[currentIndex - 1] : null;
  const nextSection = currentIndex < sections.length - 1 ? sections[currentIndex + 1] : null;

  if ("prose" in section) {
    return (
      <GuideCenterPanel
        section={section as GuideSection}
        previousSection={previousSection}
        nextSection={nextSection}
        onSelect={onSelect}
      />
    );
  }
  return (
    <ApiCenterPanel
      section={section as ApiSection}
      previousSection={previousSection}
      nextSection={nextSection}
      onSelect={onSelect}
    />
  );
}

export function GuideCenterPanel({
  section,
  previousSection,
  nextSection,
  onSelect,
}: {
  section: GuideSection;
  previousSection: Section | null;
  nextSection: Section | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div
      className="flex h-full min-w-0 flex-col overflow-y-auto"
      id="docs-content-scroll"
    >
      <div className="flex min-h-full flex-1 flex-col px-6 pt-2">
        <h1 className="mb-6 text-[26.5px] font-bold text-text">{section.title}</h1>
        <div
          id={`${section.id}-overview`}
          className="flex flex-col gap-4 text-[17.5px] leading-relaxed text-text-secondary scroll-mt-20"
        >
          {section.prose.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>

        {section.steps && (
          <div className="mt-10 flex flex-col gap-10">
            {section.steps.map((step, i) => (
              <div key={i} id={`${section.id}-step-${i}`} className="scroll-mt-20">
                <div className="mb-4 flex items-start gap-3">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-xs font-bold text-text">
                    {i + 1}
                  </span>
                  <div>
                    <h3 className="mb-1 text-sm font-semibold text-text">{step.heading}</h3>
                    <p className="text-[17.5px] leading-relaxed text-text-secondary">{step.text}</p>
                  </div>
                </div>
                {step.screenshot !== undefined && (
                  step.screenshot === null ? (
                    <div className="flex h-52 w-full items-center justify-center rounded-xl border border-dashed border-border bg-surface/40">
                      <span className="text-xs text-text-muted">Screenshot — {step.heading}</span>
                    </div>
                  ) : (
                    <img
                      src={step.screenshot}
                      alt={step.heading}
                      className="block w-full rounded-xl border border-border"
                    />
                  )
                )}
              </div>
            ))}
          </div>
        )}

        <div className="mt-8 flex flex-col gap-4">
          {section.notes.map((n, i) => (
            <div key={i} id={`${section.id}-${n.kind}`} className="scroll-mt-20">
              <NoteBlock kind={n.kind} text={n.text} />
            </div>
          ))}
        </div>

        <div className="sticky bottom-0 -mx-6 mt-auto border-t border-border bg-[#050607]/95 px-6 pb-2 pt-4 backdrop-blur-sm">
          <SectionPager previousSection={previousSection} nextSection={nextSection} onSelect={onSelect} />
        </div>
      </div>
    </div>
  );
}

export function ApiCenterPanel({
  section,
  previousSection,
  nextSection,
  onSelect,
}: {
  section: ApiSection;
  previousSection: Section | null;
  nextSection: Section | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div
      className="flex h-full min-w-0 flex-col overflow-y-auto"
      id="docs-content-scroll"
    >
      <div className="flex min-h-full flex-1 flex-col px-6 pt-2">
        <div className="mb-2 flex items-center gap-3">
          <h1 className="text-[26.5px] font-bold text-text">{section.title}</h1>
          {section.badge && (
            <span className="rounded-full border border-primary/20 bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
              {section.badge}
            </span>
          )}
        </div>
        <p className="mb-8 text-sm text-text-muted">{section.description}</p>

        <div className="flex flex-col gap-10">
          {section.endpoints.map((ep, i) => (
            <div key={i} id={`${section.id}-ep-${i}`} className="scroll-mt-20">
              <div className="mb-4 flex items-center gap-3">
                <span className={`font-mono text-xs font-bold ${methodColor[ep.method]}`}>
                  {formatLabel(ep.method)}
                </span>
                <code className="font-mono text-sm text-text-secondary">{ep.path}</code>
              </div>
              <p className="mb-4 text-sm text-text-muted">{ep.desc}</p>
              <div className="flex flex-col gap-3">
                <CodeBlock label="Request" code={ep.curl} />
                <CodeBlock label="Response" code={ep.response} />
              </div>
            </div>
          ))}
        </div>

        <div className="sticky bottom-0 -mx-6 mt-auto border-t border-border bg-[#050607]/95 px-6 pb-2 pt-4 backdrop-blur-sm">
          <SectionPager previousSection={previousSection} nextSection={nextSection} onSelect={onSelect} />
        </div>
      </div>
    </div>
  );
}

function SectionPager({
  previousSection,
  nextSection,
  onSelect,
}: {
  previousSection: Section | null;
  nextSection: Section | null;
  onSelect: (id: string) => void;
}) {
  if (!previousSection && !nextSection) return null;

  return (
    <div className="mt-0 pt-2">
      <div className="grid gap-3 sm:grid-cols-2">
        {previousSection ? (
          <button
            onClick={() => onSelect(previousSection.id)}
            className="text-left transition-colors hover:text-white"
          >
            <p className="text-xs text-text-muted mb-1">← Previous</p>
            <p className="text-sm font-medium text-text">{previousSection.title}</p>
          </button>
        ) : (
          <div />
        )}

        {nextSection ? (
          <button
            onClick={() => onSelect(nextSection.id)}
            className="text-left transition-colors hover:text-white sm:text-right"
          >
            <p className="text-xs text-text-muted mb-1">Up next →</p>
            <p className="text-sm font-medium text-text">{nextSection.title}</p>
          </button>
        ) : null}
      </div>
    </div>
  );
}
