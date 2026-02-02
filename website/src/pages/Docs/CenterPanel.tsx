import type { Section, GuideSection, ApiSection } from "./data";
import { methodColor } from "./data";
import CodeBlock from "./CodeBlock";
import NoteBlock from "./NoteBlock";


export default function CenterPanel({ section }: { section: Section }) {
  if ("prose" in section) {
    return <GuideCenterPanel section={section as GuideSection} />;
  }
  return <ApiCenterPanel section={section as ApiSection} />;
}

export function GuideCenterPanel({ section }: { section: GuideSection }) {
  return (
    <div className="px-6 py-8 sm:px-8 sm:py-10 min-w-0">
      <h1 className="text-2xl font-bold text-text mb-6">{section.title}</h1>
      <div id={`${section.id}-overview`} className="flex flex-col gap-4 text-sm leading-relaxed text-text-secondary scroll-mt-20">
        {section.prose.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>

      <div className="mt-8 flex flex-col gap-4">
        {section.notes.map((n, i) => (
          <div key={i} id={`${section.id}-${n.kind}`} className="scroll-mt-20">
            <NoteBlock kind={n.kind} text={n.text} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function ApiCenterPanel({ section }: { section: ApiSection }) {
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
                {ep.method}
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
    </div>
  );
}