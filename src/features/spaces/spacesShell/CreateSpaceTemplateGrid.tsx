import { Check } from "lucide-react";
import type { Space, SpaceTemplate } from "@/api/spaces/dto/interfaces/types";
import { Pressable, Skeleton, cn } from "@/shared/ui";
import { SpaceAvatar } from "../components/SpaceAvatar";
import { seedCounts, templateIcon } from "./templateIcons";

const cardClass = (active: boolean) =>
  cn(
    "rounded-lg border text-left",
    active
      ? "border-cream-muted/60 bg-charcoal-hover"
      : "border-charcoal-border hover:bg-charcoal-hover",
  );

export function CreateSpaceTemplateGrid({
  templates,
  selectedId,
  onSelect,
}: {
  templates: SpaceTemplate[];
  selectedId?: string;
  onSelect: (template: SpaceTemplate) => void;
}) {
  return (
    <div
      className="grid grid-cols-3 gap-2 max-[760px]:grid-cols-2"
      role="radiogroup"
      aria-label="Templates"
    >
      {templates.map((template) => {
        const active = selectedId === template.id;
        const Icon = templateIcon(template.icon);
        return (
          <Pressable
            key={template.id}
            role="radio"
            aria-checked={active}
            onClick={() => onSelect(template)}
            className={cn(cardClass(active), "grid content-start gap-1.5 p-3")}
          >
            <span className="flex min-w-0 items-center gap-2">
              <Icon size={16} strokeWidth={2} aria-hidden="true" className="shrink-0 text-cream" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-cream-bright">
                {template.name}
              </span>
              {active ? (
                <Check size={15} aria-hidden="true" className="shrink-0 text-cream-bright" />
              ) : null}
            </span>
            <span className="line-clamp-2 text-xs leading-relaxed text-cream-muted">
              {template.description}
            </span>
            <span className="text-[11px] text-cream-muted/80">{seedCounts(template)}</span>
          </Pressable>
        );
      })}
    </div>
  );
}

export function CreateSpaceTemplateGridSkeleton() {
  return (
    <div
      className="grid grid-cols-3 gap-2 max-[760px]:grid-cols-2"
      role="status"
      aria-label="Templates"
    >
      {Array.from({ length: 9 }, (_, index) => (
        <div key={index} className="grid gap-2 rounded-lg border border-charcoal-border p-3">
          <span className="flex items-center gap-2">
            <Skeleton className="size-4" />
            <Skeleton className="h-3.5 w-1/2" />
          </span>
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      ))}
    </div>
  );
}

/** Mine: saved templates, then any Space the person belongs to as a starting point. */
export function CreateSpaceMineTab({
  templates,
  templatesFailed,
  spaces,
  selectedId,
  sourceSpaceId,
  onSelect,
  onCopySpace,
}: {
  templates?: SpaceTemplate[];
  templatesFailed: boolean;
  spaces: Space[];
  selectedId?: string;
  sourceSpaceId?: string;
  onSelect: (template: SpaceTemplate) => void;
  onCopySpace: (space: Space) => void;
}) {
  return (
    <div className="grid gap-5">
      {!templates ? (
        templatesFailed ? (
          <p className="m-0 text-sm text-cream-muted">
            Your templates couldn't load. Reopen this dialog to try again.
          </p>
        ) : (
          <CreateSpaceTemplateGridSkeleton />
        )
      ) : templates.length ? (
        <CreateSpaceTemplateGrid
          templates={templates}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      ) : (
        <p className="m-0 text-sm text-cream-muted">
          Save a Space as a template from its settings to reuse its setup here.
        </p>
      )}
      {spaces.length ? (
        <div>
          <p className="m-0 mb-2 text-xs font-medium text-cream-muted">Copy a Space's structure</p>
          <div
            className="grid grid-cols-3 gap-2 max-[760px]:grid-cols-2"
            role="radiogroup"
            aria-label="Copy a Space's structure"
          >
            {spaces.map((space) => {
              const active = sourceSpaceId === space.id;
              return (
                <Pressable
                  key={space.id}
                  role="radio"
                  aria-checked={active}
                  onClick={() => onCopySpace(space)}
                  className={cn(cardClass(active), "flex items-center gap-2.5 px-3 py-2.5 text-sm")}
                >
                  <SpaceAvatar space={space} className="size-6" />
                  <span className="min-w-0 flex-1 truncate">{space.name}</span>
                  {active ? (
                    <Check size={15} aria-hidden="true" className="shrink-0 text-cream-bright" />
                  ) : null}
                </Pressable>
              );
            })}
          </div>
          <p className="m-0 mt-2 text-xs text-cream-muted">
            Copies task titles, outlines of your notes and collection names. Files, messages and
            members stay behind.
          </p>
        </div>
      ) : null}
    </div>
  );
}
