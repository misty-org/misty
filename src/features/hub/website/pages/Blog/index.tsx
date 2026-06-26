import { posts, tagColors } from "./data";

export default function Blog() {
  return (
    <div className="max-w-5xl mx-auto px-3 sm:px-4 pt-32 pb-20">
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
