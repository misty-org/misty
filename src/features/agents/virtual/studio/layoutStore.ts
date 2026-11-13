import { useCallback, useEffect, useState } from "react";
import { create } from "zustand";
import { announceDeviceSetting, onDeviceSettingChange } from "@/shared/lib/deviceSetting";
import { localDocuments } from "../../conversations/state/localChats";
import { agentAccountId } from "../../personal/agentAccount";
import { defaultLayout, parseLayout, serializeLayout, type StudioLayout } from "./layout";

/**
 * The studio's arrangement belongs to this computer, kept per Space in misty.db with the person's
 * agents and chats. It never goes to a server: only a Space's own content is kept there.
 */
const idOf = (space: string) => `layout:${space || "personal"}`;

/** Where layouts were kept before misty.db held them, read once to bring them over. */
const oldKeyOf = (space: string) => `misty.virtualOffice.layout:${space || "personal"}`;

function takeOldLayout(space: string): StudioLayout | null {
  try {
    const old = parseLayout(window.localStorage.getItem(oldKeyOf(space)));
    window.localStorage.removeItem(oldKeyOf(space));
    return old;
  } catch {
    return null;
  }
}

async function loadLayout(account: string, space: string): Promise<StudioLayout> {
  if (!localDocuments.available()) return defaultLayout();
  const saved = parseLayout(await localDocuments.get(account, "studio", idOf(space)));
  if (saved) return saved;
  const old = takeOldLayout(space);
  if (old) await saveLayout(account, space, old);
  return old ?? defaultLayout();
}

/** Other windows hear a save under this name and read their layout again. */
const announced = "studio-layout";

/** Bumped when the layout should be read again: another window saved, or a save here failed. */
const useLayoutReloads = create<{ count: number }>(() => ({ count: 0 }));
const reloadLayouts = () => useLayoutReloads.setState((state) => ({ count: state.count + 1 }));
onDeviceSettingChange(announced, reloadLayouts);

async function saveLayout(account: string, space: string, layout: StudioLayout | null) {
  if (!localDocuments.available()) return;
  if (layout) {
    const id = idOf(space);
    // The swap misses when another window wrote in between; this change is the newer one, so
    // read again and write over it.
    for (let attempt = 0; ; attempt++) {
      const known = await localDocuments.get(account, "studio", id);
      if (await localDocuments.swap(account, "studio", id, known, serializeLayout(layout))) break;
      if (attempt >= 4) throw new Error("The studio layout changed in another window.");
    }
  } else await localDocuments.remove(account, "studio", idOf(space));
  announceDeviceSetting(announced);
}

/**
 * The Space's studio layout, read from misty.db and saved there every time it changes. Saves go
 * one at a time, in order, so a quick run of moves always ends on the last one.
 */
export function useStudioLayout(space: string): {
  layout: StudioLayout | null;
  change(next: StudioLayout): void;
  reset(): void;
} {
  const account = agentAccountId();
  const [held, setHeld] = useState<{ key: string; layout: StudioLayout } | null>(null);
  const key = `${account}:${space}`;
  const reloads = useLayoutReloads((state) => state.count);
  useEffect(() => {
    let live = true;
    void loadLayout(account, space)
      .catch(() => defaultLayout())
      .then((layout) => live && setHeld({ key, layout }));
    return () => {
      live = false;
    };
  }, [account, space, key, reloads]);
  const write = useCallback(
    (next: StudioLayout | null) => {
      queue = queue
        .then(() => saveLayout(account, space, next))
        // A save that didn't land shows what is stored, rather than a room that isn't kept.
        .catch(reloadLayouts);
    },
    [account, space],
  );
  const change = useCallback(
    (next: StudioLayout) => {
      setHeld({ key, layout: next });
      write(next);
    },
    [key, write],
  );
  const reset = useCallback(() => {
    setHeld({ key, layout: defaultLayout() });
    write(null);
  }, [key, write]);
  return { layout: held?.key === key ? held.layout : null, change, reset };
}

/** Saves waiting to be written, oldest first. */
let queue: Promise<void> = Promise.resolve();
