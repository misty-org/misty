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

/* ─── Types ─── */

interface Reply {
  author: string;
  avatar: string;
  date: string;
  body: string;
  likes: number;
}

interface Thread {
  id: number;
  title: string;
  category: Category;
  author: string;
  avatar: string;
  date: string;
  body: string;
  replies: Reply[];
  views: number;
  pinned?: boolean;
  solved?: boolean;
}

type Category = "general" | "feature-requests" | "bug-reports" | "show-and-tell";

/* ─── Data ─── */

const categories: { key: Category | "all"; label: string; icon: React.ReactNode }[] = [
  { key: "all", label: "All", icon: <HiOutlineChatBubbleLeftRight className="w-4 h-4" /> },
  { key: "general", label: "General", icon: <VscComment className="w-4 h-4" /> },
  { key: "feature-requests", label: "Feature Requests", icon: <VscLightbulb className="w-4 h-4" /> },
  { key: "bug-reports", label: "Bug Reports", icon: <VscBug className="w-4 h-4" /> },
  { key: "show-and-tell", label: "Show & Tell", icon: <VscMegaphone className="w-4 h-4" /> },
];

const categoryBadge: Record<Category, string> = {
  general: "bg-text-muted/10 text-text-muted border-text-muted/20",
  "feature-requests": "bg-primary/10 text-primary border-primary/20",
  "bug-reports": "bg-danger/10 text-danger border-danger/20",
  "show-and-tell": "bg-success/10 text-success border-success/20",
};

const categoryLabel: Record<Category, string> = {
  general: "General",
  "feature-requests": "Feature Request",
  "bug-reports": "Bug Report",
  "show-and-tell": "Show & Tell",
};

const threads: Thread[] = [
  {
    id: 1,
    title: "Welcome to the Misty Community Forum",
    category: "general",
    author: "Misty Team",
    avatar: "MT",
    date: "Dec 2025",
    pinned: true,
    body: "Welcome to the Misty community! This is the place to ask questions, share feedback, report bugs, and show off what you're building with Misty. Please be respectful and follow the community guidelines.\n\nA few tips to get started:\n- Search before posting — your question may already be answered\n- Use the right category so others can find and help with your topic\n- Include steps to reproduce when reporting bugs\n\nWe're excited to have you here!",
    replies: [
      {
        author: "alex_dev",
        avatar: "AD",
        date: "Dec 2025",
        body: "Great to see a community forum! Looking forward to contributing.",
        likes: 12,
      },
      {
        author: "sarah_k",
        avatar: "SK",
        date: "Jan 2026",
        body: "Love the project so far. The unified browser is exactly what I needed.",
        likes: 8,
      },
    ],
    views: 1842,
  },
  {
    id: 2,
    title: "Request: Dropbox integration",
    category: "feature-requests",
    author: "clouduser42",
    avatar: "CU",
    date: "Jan 2026",
    body: "Would love to see Dropbox added as a supported provider. I use it alongside Google Drive for work and it would be great to manage both from Misty. Is this on the roadmap?",
    replies: [
      {
        author: "Misty Team",
        avatar: "MT",
        date: "Jan 2026",
        body: "Dropbox is on our roadmap! It's currently in the 'In Progress' phase. We're working on the OAuth flow and file listing API integration. Stay tuned.",
        likes: 24,
      },
      {
        author: "dev_maria",
        avatar: "DM",
        date: "Feb 2026",
        body: "This would be amazing. I'd also love to see Box support alongside Dropbox.",
        likes: 6,
      },
      {
        author: "clouduser42",
        avatar: "CU",
        date: "Feb 2026",
        body: "Great to hear it's already being worked on. Thanks for the quick response!",
        likes: 3,
      },
    ],
    views: 634,
  },
  {
    id: 3,
    title: "OAuth token refresh fails after sleep/hibernate",
    category: "bug-reports",
    author: "linux_power",
    avatar: "LP",
    date: "Feb 2026",
    solved: true,
    body: "After my laptop wakes from suspend, Misty loses the connection to Google Drive and the OAuth token doesn't auto-refresh. I have to manually disconnect and reconnect the account.\n\nOS: Arch Linux (Wayland)\nMisty: v0.2.1\nSteps:\n1. Connect Google Drive account\n2. Suspend laptop for 30+ minutes\n3. Wake and try to browse Drive files\n4. Get 'Authentication failed' error",
    replies: [
      {
        author: "Misty Team",
        avatar: "MT",
        date: "Feb 2026",
        body: "Thanks for the detailed report! This was a known issue related to how we handled system clock changes after suspend. It's been fixed in v0.2.1 — the proxy now detects token expiry on each request and refreshes proactively.",
        likes: 15,
      },
      {
        author: "linux_power",
        avatar: "LP",
        date: "Feb 2026",
        body: "Confirmed fixed on v0.2.1. Thanks for the fast turnaround!",
        likes: 4,
      },
    ],
    views: 287,
  },
  {
    id: 4,
    title: "My multi-cloud backup workflow with Misty",
    category: "show-and-tell",
    author: "datahoarder",
    avatar: "DH",
    date: "Feb 2026",
    body: "I set up a workflow where I use Misty to mirror important documents across Google Drive and OneDrive. Every week I open Misty, select the folders I want to sync, and use the clipboard to copy them between providers.\n\nIt's not automated (yet), but it's way faster than opening two browser tabs and downloading/uploading manually. Would love to see a 'sync folder' feature in the future!",
    replies: [
      {
        author: "backup_pro",
        avatar: "BP",
        date: "Mar 2026",
        body: "This is basically my exact workflow too. A scheduled sync feature would be a game changer.",
        likes: 9,
      },
    ],
    views: 412,
  },
  {
    id: 5,
    title: "How does Misty handle large file transfers?",
    category: "general",
    author: "new_user_99",
    avatar: "NU",
    date: "Mar 2026",
    body: "I need to move around 50GB of video files between cloud providers. Can Misty handle that, or is it better suited for smaller files? Curious about any size limits or performance considerations.",
    replies: [
      {
        author: "Misty Team",
        avatar: "MT",
        date: "Mar 2026",
        body: "Misty uses gRPC streaming for transfers, so large files are handled in chunks rather than loaded into memory all at once. There's no hard file size limit. For 50GB of video, you should be fine — the main bottleneck will be your internet upload/download speed, not Misty itself.",
        likes: 11,
      },
      {
        author: "datahoarder",
        avatar: "DH",
        date: "Mar 2026",
        body: "I regularly move 10-20GB batches without issues. The progress indicator is pretty accurate too.",
        likes: 5,
      },
    ],
    views: 198,
  },
  {
    id: 6,
    title: "S3-compatible storage — any timeline?",
    category: "feature-requests",
    author: "infra_eng",
    avatar: "IE",
    date: "Mar 2026",
    body: "I self-host MinIO and would love to connect it to Misty alongside my Google Drive. The roadmap mentions S3-compatible storage as planned — is there a rough timeline for this?\n\nWould also be great for Backblaze B2 and Wasabi users.",
    replies: [
      {
        author: "Misty Team",
        avatar: "MT",
        date: "Mar 2026",
        body: "S3-compatible storage is something we're really excited about. It's currently planned for after the Dropbox/Box integration ships. No exact date yet, but it's a high-priority item for the second half of the year.",
        likes: 18,
      },
    ],
    views: 321,
  },
  {
    id: 7,
    title: "File preview not working for .heic images",
    category: "bug-reports",
    author: "photo_fan",
    avatar: "PF",
    date: "Mar 2026",
    body: "When I try to preview .heic files from my iCloud Drive, I just get a blank preview panel. JPG and PNG work fine. Is HEIC supposed to be supported?\n\nOS: macOS 14.3\nMisty: v0.3.0",
    replies: [
      {
        author: "Misty Team",
        avatar: "MT",
        date: "Mar 2026",
        body: "HEIC preview support is not yet implemented — we currently only handle common raster formats (JPG, PNG, GIF, WebP). We'll add HEIC support in an upcoming release. Thanks for the report!",
        likes: 7,
      },
    ],
    views: 145,
  },
  {
    id: 8,
    title: "Built a script to auto-organize cloud files with Misty + API",
    category: "show-and-tell",
    author: "script_kid",
    avatar: "SK",
    date: "Mar 2026",
    body: "I wrote a small Python script that uses the Misty API to automatically sort files in my Google Drive by file type. Photos go into /Photos, documents into /Docs, etc. Runs on a cron job once a day.\n\nHappy to share the script if anyone's interested — it's about 60 lines of code.",
    replies: [
      {
        author: "alex_dev",
        avatar: "AD",
        date: "Mar 2026",
        body: "Please share! I've been looking for exactly this kind of automation.",
        likes: 14,
      },
      {
        author: "infra_eng",
        avatar: "IE",
        date: "Mar 2026",
        body: "This is awesome. Would love to see a community recipes/scripts section on the docs.",
        likes: 10,
      },
      {
        author: "script_kid",
        avatar: "SK",
        date: "Mar 2026",
        body: "Posted the gist on GitHub! Link in my profile. It uses the /files/list and /files/move endpoints.",
        likes: 8,
      },
    ],
    views: 523,
  },
];

/* ─── Sort options ─── */

type SortKey = "latest" | "popular" | "top";

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
            <span className="text-[10px] font-semibold uppercase tracking-wider text-primary bg-primary/10 px-1.5 py-0.5 rounded border border-primary/20">
              Pinned
            </span>
          )}
          {thread.solved && (
            <span className="text-[10px] font-semibold uppercase tracking-wider text-success bg-success/10 px-1.5 py-0.5 rounded border border-success/20">
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
              <span className="text-[10px] font-semibold uppercase tracking-wider text-primary bg-primary/10 px-1.5 py-0.5 rounded border border-primary/20">
                Pinned
              </span>
            )}
            {thread.solved && (
              <span className="text-[10px] font-semibold uppercase tracking-wider text-success bg-success/10 px-1.5 py-0.5 rounded border border-success/20">
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
          <span className="text-xs font-semibold uppercase tracking-widest text-text-muted block px-1 mb-2">
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
    <div className="max-w-4xl mx-auto px-4 pt-32 pb-20">
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
