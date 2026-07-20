import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Bot, LibraryBig, Paperclip, Send, Sparkles, Users, X } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useAuth } from "@/features/auth/AuthContext";
import { MistyFilePicker } from "@/features/picker/FilePicker";
import { spacesApi } from "@/stores/spaces/useSpacesBackendStore";
import type {
  MessageAttachment,
  SpaceLibraryItem,
  SpaceMember,
  SpaceMessage,
  SpaceNode,
  SpaceStudioResource,
} from "@/models/interfaces/features/spaces/types";
import { mergeSpaceMessages } from "@/stores/spaces/useSpaceMessageSpansStore";
import { buildMessageSpans, useSpacesStore } from "@/stores/spaces/useSpacesStore";
import { useSetupStore } from "@/stores/app";
import { Button } from "@/ui";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/ui";
import { Popover, PopoverAnchor, PopoverContent } from "@/ui";
import { Textarea } from "@/ui";
import { MistyLibraryPicker } from "@/features/spaces/components/MistyLibraryPicker";
import { AgentConversationPanel } from "@/pages/Studio/AgentConversation";
import { useSpaceConversationChat } from "@/features/spaces/useSpaceConversationChat";
import {
  DeleteMessageDialog,
  SpaceChatMessages,
} from "@/features/spaces/components/SpaceChatMessages";

export type ChatComposerSuggestion =
  | { kind: "member"; id: string; label: string; detail: string }
  | { kind: "agent"; id: string; label: string; detail: string }
  | { kind: "library"; id: string; label: string; detail: string; item: SpaceLibraryItem };
