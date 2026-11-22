import { ChoiceGroup } from "@misty/ui";
import { CalendarDays, LayoutGrid, List } from "lucide-react";
import { useState } from "react";
import { GalleryRow, GallerySection } from "./GalleryLayout";

type View = "month" | "week" | "agenda";
type Layout = "grid" | "list";

export function ChoicesSection() {
  const [view, setView] = useState<View>("month");
  const [layout, setLayout] = useState<Layout>("grid");
  const viewOptions = [
    { value: "month" as const, label: "Month" },
    { value: "week" as const, label: "Week" },
    { value: "agenda" as const, label: "Agenda", icon: CalendarDays },
  ];
  return (
    <GallerySection title="Choices">
      <GalleryRow label="ChoiceGroup md">
        <ChoiceGroup label="Calendar view" value={view} onChange={setView} options={viewOptions} />
      </GalleryRow>
      <GalleryRow label="ChoiceGroup sm">
        <ChoiceGroup
          label="Calendar view"
          size="sm"
          value={view}
          onChange={setView}
          options={viewOptions}
        />
      </GalleryRow>
      <GalleryRow label="Icon only">
        <ChoiceGroup
          label="View layout"
          value={layout}
          onChange={setLayout}
          options={[
            { value: "grid", label: "Grid view", icon: LayoutGrid, iconOnly: true },
            { value: "list", label: "List view", icon: List, iconOnly: true },
          ]}
        />
        <ChoiceGroup
          label="View layout"
          size="sm"
          value={layout}
          onChange={setLayout}
          options={[
            { value: "grid", label: "Grid view", icon: LayoutGrid, iconOnly: true },
            { value: "list", label: "List view", icon: List, iconOnly: true },
          ]}
        />
      </GalleryRow>
      <GalleryRow label="Disabled option">
        <ChoiceGroup
          label="Calendar view"
          value={view}
          onChange={setView}
          options={[
            { value: "month", label: "Month" },
            { value: "week", label: "Week" },
            {
              value: "agenda",
              label: "Agenda",
              disabled: true,
              reason: "Connect a calendar first",
            },
          ]}
        />
        <ChoiceGroup
          label="Calendar view"
          disabled
          value={view}
          onChange={setView}
          options={viewOptions}
        />
      </GalleryRow>
      <GalleryRow label="Fill">
        <div className="w-80">
          <ChoiceGroup
            label="Calendar view"
            fill
            value={view}
            onChange={setView}
            options={viewOptions}
          />
        </div>
      </GalleryRow>
    </GallerySection>
  );
}
