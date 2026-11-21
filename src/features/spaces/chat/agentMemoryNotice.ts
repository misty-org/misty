import { notify } from "@misty/ui";
import { createDeviceSetting } from "@/shared/lib/deviceSetting";
import { useSpacesStore } from "../list/useSpacesStore";

/** Whether this device has said, once, that an agent's engine memory carries across Spaces. */
const agentMemoryNoticeSeen = createDeviceSetting<boolean>({
  scope: "agent-memory-across-spaces-notice",
  defaults: false,
  normalize: (stored) => stored === true,
});

/**
 * The first time the person asks one of their agents for something in a shared Space (not their
 * Personal, not a DM), says once that what it learns there may come up elsewhere: an agent's
 * engine keeps one memory, whichever Space it works in.
 */
export async function noticeAgentMemoryOnce(spaceId: string) {
  const space = useSpacesStore.getState().spaces.find((item) => item.id === spaceId);
  if (!space || space.is_default) return;
  const setting = agentMemoryNoticeSeen.getState();
  if (!setting.loaded) await setting.load();
  if (agentMemoryNoticeSeen.getState().value) return;
  agentMemoryNoticeSeen.getState().set(true);
  notify({ message: "Agents remember across Spaces. What it learns here may come up elsewhere." });
}
