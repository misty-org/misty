const posts = [
  {
    title: "Introducing Misty — One App for All Your Cloud Files",
    date: "December 2025",
    summary:
      "We built Misty because managing files across Google Drive, OneDrive, and iCloud shouldn't require three different apps. Here's the story behind it.",
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
  Engineering: "bg-success/10 text-success border-success/20",
};

export default function Blog() {
  return (
    <div className="max-w-4xl mx-auto px-4 pt-32 pb-20">
      <div className="mb-12">
        <h1 className="text-3xl md:text-5xl font-bold text-text mb-4">Blog</h1>
        <p className="text-text-muted leading-relaxed">
          Updates, deep dives, and behind-the-scenes from the Misty team.
        </p>
      </div>

      <div className="flex flex-col gap-6">
        {posts.map((post) => (
          <article
            key={post.title}
            className="group rounded-xl border border-border p-6 hover:border-border hover:bg-elevated/30 transition-colors"
          >
            <div className="flex items-center gap-3 mb-3">
              <span
                className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${tagColors[post.tag] ?? "bg-elevated text-text-muted border-border"}`}
              >
                {post.tag}
              </span>
              <span className="text-xs text-text-muted">{post.date}</span>
            </div>
            <h2 className="text-lg font-semibold text-text mb-2 group-hover:text-primary transition-colors">
              {post.title}
            </h2>
            <p className="text-sm text-text-muted leading-relaxed">
              {post.summary}
            </p>
          </article>
        ))}
      </div>
    </div>
  );
}
