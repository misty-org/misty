import { create } from "zustand";
import { openExternalLink } from "@/platform/openExternalLink";
import { errorText } from "@/lib/format";
import { resolveSpacesApiBase, spacesApi } from "@/stores/spaces/useSpacesBackendStore";
import type { RealtimeEnvelope } from "@/models/types/stores/spaces/useSpacesBackendStore";
import type { SpaceRun } from "@/models/interfaces/features/spaces/types";
import type {
  Space,
  SpaceEvent,
  SpaceInboxItem,
  SpaceInvitation,
  SpaceMember,
  SpaceMessage,
  SpaceNode,
  SpaceStudioResource,
  SpacesSnapshot,
} from "@/models/interfaces/features/spaces/types";
import { buildMessageSpans, mergeSpaceMessages } from "@/stores/spaces/useSpaceMessageSpansStore";

import type { SpacesStore } from "@/models/interfaces/stores/spaces/useSpacesStore";

export type ActivityTab = "unreads" | "mentions";
