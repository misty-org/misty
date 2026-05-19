import type { Section, GuideSection, ApiSection } from "./data";

function formatLabel(value: string) {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

function getAnchors(section: Section): { id: string; label: string }[] {
  if ("prose" in section) {
    const guide = section as GuideSection;
    const anchors: { id: string; label: string }[] = [
      { id: `${section.id}-overview`, label: "Overview" },
    ];
    for (const n of guide.notes) {
      anchors.push({ id: `${section.id}-${n.kind}`, label: n.kind.charAt(0).toUpperCase() + n.kind.slice(1) });
    }
    return anchors;
  } else if ("endpoints" in section) {
    const api = section as ApiSection;
    return api.endpoints.map((ep, i) => ({
      id: `${section.id}-ep-${i}`,
      label: `${formatLabel(ep.method)} ${ep.path}`,
    }));
  }

  return [];
}

export default function RightPanel({ section }: { section: Section }) {
  const anchors = getAnchors(section);

  return (
    <aside className="sticky top-16 h-[calc(100vh-4rem)] self-start overflow-y-auto border-l border-border-subtle hidden lg:block scrollbar-hide">
      <div className="py-6 px-5">
        <span className="text-[11px] font-semibold text-text-muted mb-3 block">
          Contents
        </span>
        <nav className="flex flex-col gap-1">
          {anchors.map((a) => (
            <a
              key={a.id}
              href={`#${a.id}`}
              onClick={(e) => {
                e.preventDefault();
                document.getElementById(a.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
              className="text-sm text-text-muted hover:text-text transition-colors py-1 truncate"
            >
              {a.label}
            </a>
          ))}
        </nav>
      </div>
    </aside>
  );
}
