import { useState } from "react";
import {
  HiOutlineChatBubbleLeftRight,
  HiOutlineEye,
  HiOutlineChevronLeft,
  HiOutlineMagnifyingGlass,
  HiOutlineFire,
  HiOutlineArrowUp,
  HiOutlineArrowTrendingUp,
} from "react-icons/hi2";
import {
  VscBug,
  VscLightbulb,
  VscMegaphone,
  VscComment,
} from "react-icons/vsc";
import { categoryBadge, categoryLabel, threads } from "./data";
import type { Category, SortKey, Thread } from "./types";

const categories: { key: Category | "all"; label: string; icon: React.ReactNode }[] = [
  { key: "all", label: "All", icon: <HiOutlineChatBubbleLeftRight className="w-4 h-4" /> },
  { key: "general", label: "General", icon: <VscComment className="w-4 h-4" /> },
  { key: "feature-requests", label: "Feature Requests", icon: <VscLightbulb className="w-4 h-4" /> },
  { key: "bug-reports", label: "Bug Reports", icon: <VscBug className="w-4 h-4" /> },
  { key: "show-and-tell", label: "Show & Tell", icon: <VscMegaphone className="w-4 h-4" /> },
];

const sortOptions: { key: SortKey; label: string; icon: React.ReactNode }[] = [
  { key: "latest", label: "Latest", icon: <HiOutlineArrowTrendingUp className="w-3.5 h-3.5" /> },
  { key: "popular", label: "Popular", icon: <HiOutlineFire className="w-3.5 h-3.5" /> },
  { key: "top", label: "Most Replies", icon: <HiOutlineArrowUp className="w-3.5 h-3.5" /> },
];

function sortThreads(list: Thread[], key: SortKey): Thread[] {
  const pinned = list.filter((t) => t.pinned);
  const rest = list.filter((t) => !t.pinned);
  const sorted = [...rest].sort((a, b) => {
    if (key === "popular") return b.views - a.views;
    if (key === "top") return b.replies.length - a.replies.length;
    return b.id - a.id;
  });
  return [...pinned, ...sorted];
}

/* ─── Components ─── */

function Avatar({ initials, size = "sm" }: { initials: string; size?: "sm" | "md" }) {
  const s = size === "md" ? "w-9 h-9 text-xs" : "w-7 h-7 text-[10px]";
  return (
    <div className={`${s} rounded-full bg-elevated border border-border flex items-center justify-center font-semibold text-text-muted shrink-0`}>
      {initials}
    </div>
  );
}

function ThreadRow({ thread, onClick }: { thread: Thread; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-start gap-4 px-5 py-4 text-left hover:bg-elevated/40 transition-colors cursor-pointer border-b border-border/50 last:border-none"
    >
      <Avatar initials={thread.avatar} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          {thread.pinned && (
            <span className="text-[10px] font-semibold tracking-[0.14em] text-primary bg-primary/10 px-1.5 py-0.5 rounded border border-primary/20">
              Pinned
            </span>
          )}
          {thread.solved && (
            <span className="text-[10px] font-semibold tracking-[0.14em] text-success bg-success/10 px-1.5 py-0.5 rounded border border-success/20">
              Solved
            </span>
          )}
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${categoryBadge[thread.category]}`}>
            {categoryLabel[thread.category]}
          </span>
        </div>
        <h3 className="text-sm font-medium text-text truncate">{thread.title}</h3>
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

function ThreadDetail({ thread, onBack }: { thread: Thread; onBack: () => void }) {
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
            {thread.pinned && (
              <span className="text-[10px] font-semibold tracking-[0.14em] text-primary bg-primary/10 px-1.5 py-0.5 rounded border border-primary/20">
                Pinned
              </span>
            )}
            {thread.solved && (
              <span className="text-[10px] font-semibold tracking-[0.14em] text-success bg-success/10 px-1.5 py-0.5 rounded border border-success/20">
                Solved
              </span>
            )}
            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${categoryBadge[thread.category]}`}>
              {categoryLabel[thread.category]}
            </span>
          </div>
          <h1 className="text-xl font-bold text-text mb-4">{thread.title}</h1>
          <div className="flex items-center gap-3 mb-5">
            <Avatar initials={thread.avatar} size="md" />
            <div>
              <span className="text-sm font-medium text-text">{thread.author}</span>
              <span className="text-xs text-text-muted ml-2">{thread.date}</span>
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
            <span className="text-xs">{thread.replies.length} {thread.replies.length === 1 ? "reply" : "replies"}</span>
          </div>
        </div>
      </div>

      {/* Replies */}
      {thread.replies.length > 0 && (
        <div className="space-y-3">
          <span className="text-xs font-semibold tracking-[0.18em] text-text-muted block px-1 mb-2">
            Replies
          </span>
          {thread.replies.map((reply, i) => (
            <div key={i} className="rounded-xl border border-border/50 px-6 py-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <Avatar initials={reply.avatar} size="md" />
                  <div>
                    <span className="text-sm font-medium text-text">{reply.author}</span>
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
          ))}
        </div>
      )}

      {/* Reply box */}
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
    </div>
  );
}

/* ─── Page ─── */

export default function Forum() {
  const [activeCategory, setActiveCategory] = useState<Category | "all">("all");
  const [sort, setSort] = useState<SortKey>("latest");
  const [search, setSearch] = useState("");
  const [activeThread, setActiveThread] = useState<Thread | null>(null);

  const filtered = threads
    .filter((t) => activeCategory === "all" || t.category === activeCategory)
    .filter((t) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return t.title.toLowerCase().includes(q) || t.body.toLowerCase().includes(q) || t.author.toLowerCase().includes(q);
    });

  const sorted = sortThreads(filtered, sort);

  const totalThreads = threads.length;
  const totalReplies = threads.reduce((sum, t) => sum + t.replies.length, 0);

  return (
    <div className="max-w-5xl mx-auto px-3 sm:px-4 pt-32 pb-20">
      {/* Header */}
      <div className="mb-10">
        <h1 className="text-3xl md:text-5xl font-bold text-text mb-4">Forum</h1>
        <p className="text-text-muted leading-relaxed">
          Ask questions, share ideas, and connect with the Misty community.
        </p>
        <div className="flex items-center gap-5 mt-4">
          <span className="text-xs text-text-muted">
            <span className="text-text font-medium">{totalThreads}</span> threads
          </span>
          <span className="text-xs text-text-muted">
            <span className="text-text font-medium">{totalReplies}</span> replies
          </span>
        </div>
      </div>

      {activeThread ? (
        <ThreadDetail
          thread={activeThread}
          onBack={() => setActiveThread(null)}
        />
      ) : (
        <>
          {/* Toolbar */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
            {/* Search */}
            <div className="relative w-full sm:w-72">
              <HiOutlineMagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
              <input
                type="text"
                placeholder="Search threads..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-2 rounded-lg border border-border bg-surface text-sm text-text placeholder-text-muted focus:outline-none focus:border-primary/50 transition-colors"
              />
            </div>

            {/* Sort */}
            <div className="flex items-center gap-1">
              {sortOptions.map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => setSort(opt.key)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                    sort === opt.key
                      ? "bg-elevated text-text"
                      : "text-text-muted hover:text-text"
                  }`}
                >
                  {opt.icon}
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Categories */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 mb-6 scrollbar-hide">
            {categories.map((cat) => (
              <button
                key={cat.key}
                onClick={() => setActiveCategory(cat.key)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors cursor-pointer ${
                  activeCategory === cat.key
                    ? "bg-primary/10 text-primary"
                    : "text-text-muted hover:text-text hover:bg-elevated"
                }`}
              >
                {cat.icon}
                {cat.label}
              </button>
            ))}
          </div>

          {/* Thread list */}
          <div className="rounded-xl border border-border overflow-hidden">
            {sorted.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <p className="text-sm text-text-muted">No threads found.</p>
              </div>
            ) : (
              sorted.map((thread) => (
                <ThreadRow
                  key={thread.id}
                  thread={thread}
                  onClick={() => setActiveThread(thread)}
                />
              ))
            )}
          </div>

          {/* New thread CTA */}
          <div className="mt-6 flex justify-center">
            <button className="px-5 py-2.5 bg-primary hover:bg-primary-hover text-bg text-sm font-medium rounded-lg transition-colors cursor-pointer">
              Start a Thread
            </button>
          </div>
        </>
      )}
    </div>
  );
}
