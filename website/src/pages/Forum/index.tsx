import { useState } from "react";

import CategoryTabs, { type CategoryFilter } from "./components/CategoryTabs";
import ForumHeader from "./components/ForumHeader";
import ForumToolbar from "./components/ForumToolbar";
import ThreadDetail from "./components/ThreadDetail";
import ThreadList from "./components/ThreadList";
import { threads } from "./data";
import { searchThreads, sortThreads } from "./filters";
import type { SortKey, Thread } from "./types";

export default function Forum() {
  const [activeCategory, setActiveCategory] = useState<CategoryFilter>("all");
  const [sort, setSort] = useState<SortKey>("latest");
  const [search, setSearch] = useState("");
  const [activeThread, setActiveThread] = useState<Thread | null>(null);

  const byCategory = threads.filter(
    (thread) => activeCategory === "all" || thread.category === activeCategory,
  );
  const visible = sortThreads(searchThreads(byCategory, search), sort);

  const totalReplies = threads.reduce(
    (sum, thread) => sum + thread.replies.length,
    0,
  );

  return (
    <div className="max-w-5xl mx-auto px-3 sm:px-4 pt-32 pb-20">
      <ForumHeader
        totalThreads={threads.length}
        totalReplies={totalReplies}
      />

      {activeThread ? (
        <ThreadDetail
          thread={activeThread}
          onBack={() => setActiveThread(null)}
        />
      ) : (
        <>
          <ForumToolbar
            search={search}
            sort={sort}
            onSearchChange={setSearch}
            onSortChange={setSort}
          />

          <CategoryTabs active={activeCategory} onChange={setActiveCategory} />

          <ThreadList threads={visible} onSelect={setActiveThread} />

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
