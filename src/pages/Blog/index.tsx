import { Badge } from "@/components/ui/badge";
import { posts, tagColors } from "./data";

export default function Blog() {
  return (
    <div className="mx-auto max-w-5xl px-4 pb-20 pt-28 sm:px-6 sm:pt-32">
      <header className="border-b border-border pb-8">
        <p className="mb-3 font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Blog
        </p>
        <h1 className="text-3xl font-semibold tracking-[-0.03em] text-foreground md:text-5xl">
          Notes from Misty
        </h1>
      </header>

      <div>
        {posts.map((post) => (
          <article key={post.title} className="grid gap-5 border-b border-border py-8 sm:grid-cols-[9rem_1fr] sm:gap-10">
            <div>
              <Badge variant="outline" className={tagColors[post.tag] ?? "bg-muted text-muted-foreground"}>
                {post.tag}
              </Badge>
              <p className="mt-2 text-xs text-muted-foreground">{post.date}</p>
            </div>
            <div className="max-w-2xl">
              <h2 className="text-xl font-semibold tracking-[-0.02em] text-foreground">
                {post.title}
              </h2>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">{post.summary}</p>
              {post.historicalContext ? (
                <p className="mt-3 text-xs leading-5 text-muted-foreground/80">
                  Archived: {post.historicalContext}
                </p>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
