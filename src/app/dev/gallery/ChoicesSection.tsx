import { ChoiceGroup, FilterChip } from "@/shared/ui";
import { CalendarDays, LayoutGrid, List, MessageSquare, Pin } from "lucide-react";
import { useState } from "react";
import { GalleryRow, GallerySection } from "./GalleryLayout";

type View = "month" | "week" | "agenda";
type Layout = "grid" | "list";

const filters = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "pinned", label: "Pinned", icon: Pin },
  { value: "mentions", label: "Mentions", icon: MessageSquare },
] as const;

export function ChoicesSection() {
  const [view, setView] = useState<View>("month");
  const [layout, setLayout] = useState<Layout>("grid");
  const [filter, setFilter] = useState<string>("all");
  const [tags, setTags] = useState<ReadonlySet<string>>(new Set(["design"]));
  const toggleTag = (tag: string, on: boolean) =>
    setTags((current) => {
      const next = new Set(current);
      if (on) next.add(tag);
      else next.delete(tag);
      return next;
    });
  const viewOptions = [
    { value: "month" as const, label: "Month" },
    { value: "week" as const, label: "Week" },
    { value: "agenda" as const, label: "Agenda", icon: CalendarDays },
  ];
  return (
    <GallerySection title="Choices and filters">
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
      <GalleryRow label="FilterChip, one at a time">
        {filters.map((item) => (
          <FilterChip
            key={item.value}
            label={item.label}
            icon={"icon" in item ? item.icon : undefined}
            pressed={filter === item.value}
            onPressedChange={() => setFilter(item.value)}
          />
        ))}
      </GalleryRow>
      <GalleryRow label="FilterChip sm, several">
        {["design", "research", "planning"].map((tag) => (
          <FilterChip
            key={tag}
            size="sm"
            label={tag[0].toUpperCase() + tag.slice(1)}
            pressed={tags.has(tag)}
            onPressedChange={(on) => toggleTag(tag, on)}
          />
        ))}
        <FilterChip
          size="sm"
          label="Archived"
          pressed={false}
          disabled
          onPressedChange={() => {}}
        />
      </GalleryRow>
    </GallerySection>
  );
}
