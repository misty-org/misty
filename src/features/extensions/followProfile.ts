import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { currentProfile } from "@/features/workspace/profileWindow";
import { extensionsNative } from "./native";
import { install, installations, updateInstallation } from "./store";

interface ProfileExtensions {
  present: { id: string; enabled: boolean }[];
  removed: string[];
}

/**
 * Extensions installed, removed or switched on or off in this profile elsewhere follow here.
 * Packages never travel: each computer fetches and checks its own from the store. An extension
 * that can't be fetched stays as it is and gets another try with the next change or launch.
 */
async function follow() {
  const { present, removed } = await invoke<ProfileExtensions>("profile_extensions_list");
  const here = new Map(installations().map((item) => [item.id, item]));
  for (const id of removed)
    if (here.get(id)?.installed)
      await updateInstallation(id, { installed: false, enabled: false }).catch(() => undefined);
  for (const { id, enabled } of present) {
    const item = here.get(id);
    try {
      if (!item?.installed) {
        const review = await extensionsNative.prepare(id);
        await install(review, false);
      }
      if ((item?.enabled ?? true) !== enabled) await updateInstallation(id, { enabled });
    } catch {
      continue;
    }
  }
}

/** Only one window of a profile does this, the one hosting its extensions. */
export function startFollowingProfile(): () => void {
  let stopped = false;
  let queue: Promise<unknown> = Promise.resolve();
  const run = () => {
    queue = queue
      .then(async () => {
        if (!stopped && (await invoke<boolean>("profile_window_is_host"))) await follow();
      })
      .catch(() => undefined);
  };
  const stopListening = listen<{ profile: string; collection: string; remote: boolean }>(
    "misty://profile-records-changed",
    ({ payload }) => {
      if (payload.remote && payload.collection === "extensions")
        if (payload.profile === currentProfile().id) run();
    },
  ).catch(() => undefined);
  run();
  return () => {
    stopped = true;
    void stopListening.then((stop) => stop?.());
  };
}
