import type { Section } from "./types";

export default function SectionPager({
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
    <div className="sticky bottom-0 min-w-0 border-t border-border bg-[#050607]/95 px-6 pb-2 pt-4 backdrop-blur-sm">
      <div className="grid gap-3 sm:grid-cols-2">
        {previousSection ? (
          <button
            onClick={() => onSelect(previousSection.id)}
            className="text-left transition-colors hover:text-white"
          >
            <p className="mb-1 text-xs text-text-muted">Previous</p>
            <p className="text-sm font-medium text-text">
              {previousSection.title}
            </p>
          </button>
        ) : (
          <div />
        )}

        {nextSection ? (
          <button
            onClick={() => onSelect(nextSection.id)}
            className="text-left transition-colors hover:text-white sm:text-right"
          >
            <p className="mb-1 text-xs text-text-muted">Up next</p>
            <p className="text-sm font-medium text-text">{nextSection.title}</p>
          </button>
        ) : null}
      </div>
    </div>
  );
}
