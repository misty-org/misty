import { NavLink } from "react-router";
import { posts, tagColors } from "../Blog/data";

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

      <div className="grid grid-cols-1 gap-4">
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
