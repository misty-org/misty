import { notify } from "@misty/ui";
import { createDeviceSetting } from "@/shared/lib/device_setting";
import { useSpacesStore } from "../list/use_spaces_store";

const agentMemoryNoticeSeen = createDeviceSetting<boolean>({
  scope: "agent-memory-across-spaces-notice",
  defaults: false,
  normalize: (stored) => stored === true,
});

export async function noticeAgentMemoryOnce(spaceId: string) {
  const space = useSpacesStore.getState().spaces.find((item) => item.id === spaceId);
  if (!space || space.is_default) return;
  const setting = agentMemoryNoticeSeen.getState();
  if (!setting.loaded) await setting.load();
  if (agentMemoryNoticeSeen.getState().value) return;
  agentMemoryNoticeSeen.getState().set(true);
  notify({ message: "Agents remember across Spaces. What it learns here may come up elsewhere." });
}
