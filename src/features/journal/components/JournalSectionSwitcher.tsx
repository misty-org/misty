import { NotebookPen, PenTool } from "lucide-react";
import { SpaceSidebarSection } from "@/features/spaces/components/SpaceSidebarSection";
import { SpaceSidebarLink } from "@/features/spaces/components/spacePanel/SpaceSidebarLink";

export function JournalSectionSwitcher({ spaceId, section }: { spaceId: string; section: string }) {
  const spacePath = `/spaces/${encodeURIComponent(spaceId)}`;

  return (
    <SpaceSidebarSection title="Journal">
      <nav className="grid gap-1" aria-label="Journal sections">
        <SpaceSidebarLink
          active={section === "notes"}
          icon={NotebookPen}
          label="Notes"
          to={`${spacePath}/notes`}
        />
        <SpaceSidebarLink
          active={section === "drawings"}
          icon={PenTool}
          label="Drawings"
          to={`${spacePath}/drawings`}
        />
      </nav>
    </SpaceSidebarSection>
  );
}
