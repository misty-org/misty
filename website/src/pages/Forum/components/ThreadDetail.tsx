import {
  HiOutlineArrowUp,
  HiOutlineChatBubbleLeftRight,
  HiOutlineChevronLeft,
  HiOutlineEye,
} from "react-icons/hi2";

import type { Reply, Thread } from "../types";
import ForumAvatar from "./ForumAvatar";
import ThreadBadges from "./ThreadBadges";

function ReplyCard({ reply }: { reply: Reply }) {
  return (
    <div className="rounded-xl border border-border/50 px-6 py-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <ForumAvatar initials={reply.avatar} size="md" />
          <div>
            <span className="text-sm font-medium text-text">
              {reply.author}
            </span>
            <span className="text-xs text-text-muted ml-2">{reply.date}</span>
          </div>
        </div>
        {reply.likes > 0 && (
          <div className="flex items-center gap-1 text-text-muted">
            <HiOutlineArrowUp className="w-3.5 h-3.5" />
            <span className="text-xs">{reply.likes}</span>
          </div>
        )}
      </div>
      <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-line">
        {reply.body}
      </p>
    </div>
  );
}

function ReplyComposer() {
  return (
    <div className="mt-6 rounded-xl border border-border overflow-hidden">
      <textarea
        placeholder="Write a reply..."
        className="w-full bg-transparent px-5 py-4 text-sm text-text placeholder-text-muted resize-none focus:outline-none min-h-[100px]"
      />
      <div className="px-5 py-3 border-t border-border/50 flex justify-end">
        <button className="px-4 py-2 bg-primary hover:bg-primary-hover text-bg text-sm font-medium rounded-lg transition-colors cursor-pointer">
          Reply
        </button>
      </div>
    </div>
  );
}

export default function ThreadDetail({
  thread,
  onBack,
}: {
  thread: Thread;
  onBack: () => void;
}) {
  return (
    <div>
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-text-muted hover:text-text transition-colors mb-6 cursor-pointer"
      >
        <HiOutlineChevronLeft className="w-4 h-4" />
        Back to threads
      </button>

      {/* Original post */}
      <div className="rounded-xl border border-border overflow-hidden mb-4">
        <div className="px-6 py-5">
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <ThreadBadges thread={thread} />
          </div>
          <h1 className="text-xl font-bold text-text mb-4">{thread.title}</h1>
          <div className="flex items-center gap-3 mb-5">
            <ForumAvatar initials={thread.avatar} size="md" />
            <div>
              <span className="text-sm font-medium text-text">
                {thread.author}
              </span>
              <span className="text-xs text-text-muted ml-2">
                {thread.date}
              </span>
            </div>
          </div>
          <div className="text-sm text-text-secondary leading-relaxed whitespace-pre-line">
            {thread.body}
          </div>
        </div>
        <div className="px-6 py-3 border-t border-border/50 flex items-center gap-4">
          <div className="flex items-center gap-1.5 text-text-muted">
            <HiOutlineEye className="w-3.5 h-3.5" />
            <span className="text-xs">{thread.views} views</span>
          </div>
          <div className="flex items-center gap-1.5 text-text-muted">
            <HiOutlineChatBubbleLeftRight className="w-3.5 h-3.5" />
            <span className="text-xs">
              {thread.replies.length}{" "}
              {thread.replies.length === 1 ? "reply" : "replies"}
            </span>
          </div>
        </div>
      </div>

      {thread.replies.length > 0 && (
        <div className="space-y-3">
          <span className="text-xs font-semibold tracking-[0.18em] text-text-muted block px-1 mb-2">
            Replies
          </span>
          {thread.replies.map((reply, index) => (
            <ReplyCard key={index} reply={reply} />
          ))}
        </div>
      )}

      <ReplyComposer />
    </div>
  );
}
