import type { Section } from "./types";

export default function ContentPanel({ section }: { section: Section }) {
  const SectionContent = section.Component;

  return (
    <main
      className="flex h-full min-w-0 flex-col overflow-y-auto"
      id="docs-content-scroll"
    >
      <div className="flex min-h-full flex-1 flex-col px-6 pt-2">
        <div className="pb-8">
          <SectionContent section={section} />
        </div>
      </div>
    </main>
  );
}
