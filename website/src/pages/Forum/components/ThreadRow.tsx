import { HiOutlineChatBubbleLeftRight, HiOutlineEye } from "react-icons/hi2";

import type { Thread } from "../types";
import ForumAvatar from "./ForumAvatar";
import ThreadBadges from "./ThreadBadges";

export default function ThreadRow({
  thread,
  onClick,
}: {
  thread: Thread;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-start gap-4 px-5 py-4 text-left hover:bg-elevated/40 transition-colors cursor-pointer border-b border-border/50 last:border-none"
    >
      <ForumAvatar initials={thread.avatar} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <ThreadBadges thread={thread} />
        </div>
        <h3 className="text-sm font-medium text-text truncate">
          {thread.title}
        </h3>
        <div className="flex items-center gap-3 mt-1.5">
          <span className="text-xs text-text-muted">{thread.author}</span>
          <span className="text-xs text-text-muted/50">·</span>
          <span className="text-xs text-text-muted">{thread.date}</span>
        </div>
      </div>
      <div className="hidden sm:flex items-center gap-5 shrink-0 pt-1">
        <div className="flex items-center gap-1.5 text-text-muted">
          <HiOutlineChatBubbleLeftRight className="w-3.5 h-3.5" />
          <span className="text-xs">{thread.replies.length}</span>
        </div>
        <div className="flex items-center gap-1.5 text-text-muted">
          <HiOutlineEye className="w-3.5 h-3.5" />
          <span className="text-xs">{thread.views}</span>
        </div>
      </div>
    </button>
  );
}
