import { NavLink } from "react-router";

const posts = [
  {
    title: "Introducing Misty — One App for All Your Cloud Files",
    date: "December 2025",
    summary:
      "We built Misty because managing files across Google Drive, OneDrive, and iCloud shouldn't require three different apps.",
    tag: "Announcement",
  },
  {
    title: "How Misty Keeps Your Data Private by Design",
    date: "January 2026",
    summary:
      "Misty never stores your credentials or files externally. A deep dive into our local proxy architecture and why it matters.",
    tag: "Engineering",
  },
  {
    title: "Building a Cross-Platform Desktop App with ImGui and Go",
    date: "February 2026",
    summary:
      "Technical lessons from combining a C++ ImGui frontend with a Go gRPC backend — the trade-offs, the wins, and what we'd do differently.",
    tag: "Engineering",
  },
];

const tagColors: Record<string, string> = {
  Announcement: "bg-primary/10 text-primary border-primary/20",
  Engineering: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
};

export default function BlogPreview() {
  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-3xl md:text-4xl font-bold text-text tracking-tight">
          Blog
        </h2>
        <NavLink
          to="/blog"
          className="text-sm text-text-muted hover:text-text transition-colors flex items-center gap-1.5 group"
        >
          View all posts
          <span className="group-hover:translate-x-1 transition-transform duration-300">
            &rarr;
          </span>
        </NavLink>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {posts.map((post) => (
          <article
            key={post.title}
            className="glass-card rounded-2xl p-8 flex flex-col"
          >
            <div className="flex items-center gap-3 mb-4">
              <span
                className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${tagColors[post.tag] ?? "bg-elevated text-text-muted border-border"}`}
              >
                {post.tag}
              </span>
              <span className="text-xs text-text-muted">{post.date}</span>
            </div>
            <h3 className="text-lg font-semibold text-text mb-3">
              {post.title}
            </h3>
            <p className="text-sm text-text-muted leading-relaxed">
              {post.summary}
            </p>
          </article>
        ))}
      </div>
    </div>
  );
}
