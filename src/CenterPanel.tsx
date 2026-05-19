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
    <div className="px-6 py-8 sm:px-8 sm:py-10 min-w-0">
      <h1 className="text-2xl font-bold text-text mb-6">{section.title}</h1>
      <div id={`${section.id}-overview`} className="flex flex-col gap-4 text-sm leading-relaxed text-text-secondary scroll-mt-20">
        {section.prose.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>

      {section.steps && (
        <div className="mt-10 flex flex-col gap-10">
          {section.steps.map((step, i) => (
            <div key={i} id={`${section.id}-step-${i}`} className="scroll-mt-20">
              <div className="flex items-start gap-3 mb-4">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-surface border border-border text-xs font-bold text-text flex items-center justify-center mt-0.5">
                  {i + 1}
                </span>
                <div>
                  <h3 className="text-sm font-semibold text-text mb-1">{step.heading}</h3>
                  <p className="text-sm text-text-secondary leading-relaxed">{step.text}</p>
                </div>
              </div>
              {step.screenshot !== undefined && (
                step.screenshot === null ? (
                  <div className="w-full rounded-xl border border-dashed border-border bg-surface/40 h-52 flex items-center justify-center">
                    <span className="text-xs text-text-muted">Screenshot — {step.heading}</span>
                  </div>
                ) : (
                  <img
                    src={step.screenshot}
                    alt={step.heading}
                    className="w-full rounded-xl border border-border block"
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

      <SectionPager previousSection={previousSection} nextSection={nextSection} onSelect={onSelect} />
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
    <div className="px-6 py-8 sm:px-8 sm:py-10 min-w-0">
      <div className="flex items-center gap-3 mb-2">
        <h1 className="text-2xl font-bold text-text">{section.title}</h1>
        {section.badge && (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20">
            {section.badge}
          </span>
        )}
      </div>
      <p className="text-sm text-text-muted mb-8">{section.description}</p>

      <div className="flex flex-col gap-10">
        {section.endpoints.map((ep, i) => (
          <div key={i} id={`${section.id}-ep-${i}`} className="scroll-mt-20">
            <div className="flex items-center gap-3 mb-4">
              <span className={`font-mono text-xs font-bold ${methodColor[ep.method]}`}>
                {formatLabel(ep.method)}
              </span>
              <code className="font-mono text-sm text-text-secondary">{ep.path}</code>
            </div>
            <p className="text-sm text-text-muted mb-4">{ep.desc}</p>
            <div className="flex flex-col gap-3">
              <CodeBlock label="Request" code={ep.curl} />
              <CodeBlock label="Response" code={ep.response} />
            </div>
          </div>
        ))}
      </div>

      <SectionPager previousSection={previousSection} nextSection={nextSection} onSelect={onSelect} />
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
    <div className="mt-12 border-t border-border pt-6">
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
