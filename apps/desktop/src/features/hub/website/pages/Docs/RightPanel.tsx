import type { Section } from "./types";

function getAnchors(section: Section): { id: string; label: string }[] {
  if (section.anchors) return section.anchors;

  const anchors: { id: string; label: string }[] = [
    { id: `${section.id}-overview`, label: "Overview" },
  ];

  for (const [index, step] of (section.steps ?? []).entries()) {
    anchors.push({
      id: `${section.id}-step-${index}`,
      label: step.heading,
    });
  }

  for (const screenshot of section.screenshots ?? []) {
    anchors.push({
      id: screenshot.id,
      label: screenshot.caption ?? screenshot.alt,
    });
  }

  for (const note of section.notes) {
    anchors.push({
      id: `${section.id}-${note.kind}`,
      label: note.kind.charAt(0).toUpperCase() + note.kind.slice(1),
    });
  }

  return anchors;
}

export default function RightPanel({ section }: { section: Section }) {
  const anchors = getAnchors(section);

  return (
    <aside className="hidden h-full overflow-y-auto border-l border-border-subtle px-5 py-4 scrollbar-hide lg:block">
      <span className="mb-3 block text-[13px] font-semibold text-text-muted">
        Contents
      </span>
      <nav className="flex flex-col gap-1">
        {anchors.map((anchor) => (
          <a
            key={anchor.id}
            href={`#${anchor.id}`}
            onClick={(event) => {
              event.preventDefault();
              document
                .getElementById(anchor.id)
                ?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            className="truncate py-1 text-[16.75px] text-text-muted transition-colors hover:text-text"
          >
            {anchor.label}
          </a>
        ))}
      </nav>
    </aside>
  );
}
