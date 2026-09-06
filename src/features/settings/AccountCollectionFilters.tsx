import { useState, type ComponentProps } from "react";
import { CollectionFilters } from "@/shared/ui";
import { useSettingsProfiles } from "./profiles/store";
import { resolveSetting } from "./profiles/model";

export type CollectionTabs =
  "space" | "chat" | "journal" | "planner" | "library" | "agents" | "extensions";

/** Append new tabs, ignore unavailable ones, and never duplicate a saved tab. */
export function orderedTabs<T extends { value: string }>(options: T[], raw: string): T[] {
  const ids = savedTabIds(raw);
  return [...new Set([...ids, ...options.map((option) => option.value)])].flatMap(
    (id) => options.find((option) => option.value === id) ?? [],
  );
}

export function savedTabIds(raw: string): string[] {
  let saved: unknown;
  try {
    saved = JSON.parse(raw);
  } catch {
    saved = [];
  }
  return Array.isArray(saved)
    ? [...new Set(saved.filter((id): id is string => typeof id === "string"))]
    : [];
}

export function mergeTabOrder(raw: string, ids: string[]) {
  const previous = savedTabIds(raw);
  const visible = new Set(ids);
  let index = 0;
  const merged = previous.map((value) => (visible.has(value) ? ids[index++] : value));
  return [...merged, ...ids.slice(index)];
}

export function AccountCollectionFilters({
  collectionId,
  ...props
}: Omit<ComponentProps<typeof CollectionFilters>, "onReorder"> & { collectionId: CollectionTabs }) {
  const id = `collections.tabs.${collectionId}`;
  const raw = useSettingsProfiles((store) =>
    store.state ? String(resolveSetting(store.state, id).value) : "[]",
  );
  const accountId = useSettingsProfiles((store) => store.accountId);
  const ready = useSettingsProfiles((store) => store.ready);
  const edit = useSettingsProfiles((store) => store.edit);
  const [failure, setFailure] = useState<{ accountId: string; message: string }>();
  return (
    <>
      <CollectionFilters
        {...props}
        options={orderedTabs(props.options, raw)}
        onReorder={
          ready && accountId
            ? (ids) => {
                // Retain temporarily hidden sections when another section is moved.
                const merged = mergeTabOrder(raw, ids);
                setFailure(undefined);
                void edit(id, JSON.stringify(merged)).catch(() =>
                  setFailure({
                    accountId,
                    message: "Tab order couldn’t be saved. Try moving the tab again.",
                  }),
                );
              }
            : undefined
        }
      />
      {failure?.accountId === accountId && (
        <p role="alert" className="text-sm text-cream-muted">
          {failure.message}
        </p>
      )}
    </>
  );
}
