import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { currentProfile } from "@/features/workspace/profileWindow";
import { extensionStore, installations, updateInstallation, useExtensionsStore } from "./store";

interface ProfileExtensions {
  present: { id: string; name: string; enabled: boolean }[];
  removed: string[];
}

/**
 * Follows this profile's extensions on other computers. Another computer's list can't approve
 * anything here: an extension added elsewhere is only offered here, in Settings, and goes
 * through the same review as any other. Removals and on/off switches of what's already approved
 * here do follow.
 */
export async function follow(host = true) {
  const { present, removed } = await invoke<ProfileExtensions>("profile_extensions_list");
  const here = new Map(installations().map((item) => [item.id, item]));
  if (host) {
    for (const id of removed)
      if (here.get(id)?.installed)
        await updateInstallation(id, { installed: false, enabled: false }).catch(() => undefined);
    for (const { id, enabled } of present) {
      const item = here.get(id);
      if (item?.installed && item.enabled !== enabled)
        await updateInstallation(id, { enabled }).catch(() => undefined);
    }
  }
  useExtensionsStore.setState({
    fromProfile: present
      .filter(({ id }) => extensionStore(id) !== null && !here.get(id)?.installed)
      .map(({ id, name }) => ({ id, name })),
  });
}

/** Only one window of a profile changes anything, the one hosting its extensions. Each knows
 * what's on offer, as any of them can show Settings. */
export function startFollowingProfile(): () => void {
  let stopped = false;
  let queue: Promise<unknown> = Promise.resolve();
  const run = () => {
    queue = queue
      .then(async () => {
        if (!stopped) await follow(await invoke<boolean>("profile_window_is_host"));
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
