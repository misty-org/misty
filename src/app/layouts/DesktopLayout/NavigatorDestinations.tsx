import { useId, useState, type ReactNode } from "react";
import { isSideDock, type DockPosition } from "@/features/app-shell/dockingLayout";
import {
  mergeTabOrder,
  orderedTabs,
  savedTabIds,
} from "@/features/settings/AccountCollectionFilters";
import { resolveSetting, useSettingsProfiles } from "@/features/settings";
import { reorderIds, usePointerReorder } from "@/shared/hooks/usePointerReorder";
import { cn, Notification } from "@/shared/ui";

const orderSetting = "collections.tabs.navigator";
const hiddenSetting = "app.navigation.hidden";

/** Reorder destinations as units, keeping expanded tray children with their parent. */
export function NavigatorDestinations({
  position,
  items,
}: {
  position: DockPosition;
  items: { value: string; label: string; content: ReactNode }[];
}) {
  const instance = useId();
  const accountId = useSettingsProfiles((store) => store.accountId);
  const ready = useSettingsProfiles((store) => store.ready);
  const edit = useSettingsProfiles((store) => store.edit);
  const raw = useSettingsProfiles((store) =>
    store.state ? String(resolveSetting(store.state, orderSetting).value) : "[]",
  );
  const hidden = useSettingsProfiles((store) =>
    store.state ? String(resolveSetting(store.state, hiddenSetting).value) : "[]",
  );
  // Hidden destinations keep their saved order so they return where they were.
  const ordered = orderedTabs(
    items.filter((item) => !savedTabIds(hidden).includes(item.value)),
    raw,
  );
  const ids = ordered.map((item) => item.value);
  const enabled = ready && Boolean(accountId);
  const vertical = isSideDock(position);
  const [failure, setFailure] = useState<string>();
  const [announcement, announce] = useState("");
  const save = (next: string[]) => {
    if (!enabled || next.every((id, index) => id === ids[index])) return;
    setFailure(undefined);
    void edit(orderSetting, JSON.stringify(mergeTabOrder(raw, next))).catch(() =>
      setFailure(accountId),
    );
  };
  const reorder = usePointerReorder({
    // Changing accounts, readiness or orientation cancels any in-flight gesture.
    scope: `${instance}:${accountId}:${enabled}:${position}`,
    animate: true,
    axis: vertical ? "y" : "x",
    getDrag: (id) =>
      enabled ? { id, label: ordered.find((item) => item.value === id)!.label } : null,
    onDrop: (drag, target, after) => save(reorderIds(ids, [drag.id], target, after)),
    onKeyboardMove: (id, direction) => {
      const index = ids.indexOf(id);
      const target = ids[index + direction];
      if (!enabled || !target) return;
      save(reorderIds(ids, [id], target, direction === 1));
      announce(
        `${ordered[index].label} moved to position ${index + direction + 1} of ${ids.length}.`,
      );
    },
  });
  const hint = `Drag to reorder · Alt+Shift+${vertical ? "Up/Down" : "Left/Right"}`;
  return (
    <>
      <div
        {...reorder}
        onKeyDownCapture={(event) => {
          // Child destinations keep their own keyboard behavior.
          if ((event.target as Element).closest("[data-reorder-handle]"))
            reorder.onKeyDownCapture(event);
        }}
        className={cn(
          "misty-navigator-items grid content-start gap-0.5 overflow-y-auto overflow-x-hidden px-3 pb-2",
          "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        )}
      >
        {ordered.map((item) => (
          <div
            key={item.value}
            data-reorder-item={item.value}
            data-reorder-preview="true"
            role="group"
            aria-label={`${item.label} navigation`}
            aria-description={enabled ? hint : undefined}
            title={enabled ? hint : undefined}
          >
            {item.content}
          </div>
        ))}
      </div>
      <span className="sr-only" role="status">
        {announcement}
      </span>
      {failure === accountId && (
        <Notification
          title="Navigation order couldn’t be saved"
          tone="error"
          onDismiss={() => setFailure(undefined)}
        >
          Try moving the tab again.
        </Notification>
      )}
    </>
  );
}
