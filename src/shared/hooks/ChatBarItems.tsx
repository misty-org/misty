import type { ReactNode } from "react";
import { MoreHorizontal, Phone, Video } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  IconButton,
  type ActionBarItem,
} from "@misty/ui";

export type ChatBarCalls = {
  disabled: boolean;
  videoDisabled?: boolean;
  start(video: boolean): void;
};

export function chatCallItems(calls?: ChatBarCalls): ActionBarItem[] {
  if (!calls) return [];
  return [
    {
      id: "voice-call",
      icon: Phone,
      label: "Voice call",
      priority: 6,
      disabled: calls.disabled,
      onSelect: () => calls.start(false),
    },
    {
      id: "video-call",
      icon: Video,
      label: "Video call",
      priority: 6,
      disabled: calls.disabled || Boolean(calls.videoDisabled),
      onSelect: () => calls.start(true),
    },
  ];
}

export function chatMoreItem(rows?: ReactNode): ActionBarItem[] {
  if (!rows) return [];
  return [
    {
      id: "more",
      icon: MoreHorizontal,
      label: "More",
      priority: 9,
      menu: rows,
      render: () => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton label="More" variant="quiet">
              <MoreHorizontal />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" aria-label="Chat actions">
            {rows}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];
}
