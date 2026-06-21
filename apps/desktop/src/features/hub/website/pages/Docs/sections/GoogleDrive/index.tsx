import NoteBlock from "../../NoteBlock";
import DocsScreenshot from "../../DocsScreenshot";
import type { SectionData } from "../../types";

export { data } from "./data";

function proseParagraphs(prose: string) {
  return prose
    .split(/\n\s*\n/g)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function screenshotsAfterParagraph(section: SectionData, paragraphIndex: number) {
  return (section.screenshots ?? []).filter(
    (screenshot) => screenshot.afterParagraph === paragraphIndex + 1,
  );
}

export default function GoogleDrive({ section }: { section: SectionData }) {
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
          <div key={index}>
            <p>{paragraph}</p>
            {screenshotsAfterParagraph(section, index).map((screenshot) => (
              <DocsScreenshot key={screenshot.id} screenshot={screenshot} />
            ))}
          </div>
        ))}
      </div>

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
