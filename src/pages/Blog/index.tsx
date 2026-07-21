import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { posts, tagColors } from "./data";

export default function Blog() {
  return (
    <div className="mx-auto max-w-5xl px-4 pb-20 pt-28 sm:px-6 sm:pt-32">
      <header className="mb-10 border-b border-border pb-8">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-primary">
          Notes from Misty
        </p>
        <h1 className="text-3xl font-semibold tracking-[-0.03em] text-foreground md:text-5xl">
          Blog
        </h1>
        <p className="mt-4 max-w-2xl leading-relaxed text-muted-foreground">
          Product notes and archived announcements.
        </p>
      </header>

      <div className="flex flex-col gap-6">
        {posts.map((post) => (
          <Card
            key={post.title}
            role="article"
            className="gap-0 rounded-xl py-0"
          >
            <CardHeader className="p-6">
              <div className="mb-3 flex items-center gap-3">
                <Badge
                  variant="outline"
                  className={tagColors[post.tag] ?? "bg-muted text-muted-foreground"}
                >
                  {post.tag}
                </Badge>
                <span className="text-xs text-muted-foreground">{post.date}</span>
              </div>
              <h2 className="mb-2 text-lg font-semibold text-foreground">
                {post.title}
              </h2>
              {post.historicalContext ? (
                <p className="mb-4 border-l-2 border-primary/50 pl-4 text-sm leading-relaxed text-foreground/80">
                  {post.historicalContext}
                </p>
              ) : null}
              <p className="text-sm leading-relaxed text-muted-foreground">
                {post.summary}
              </p>
            </CardHeader>
          </Card>
        ))}
      </div>
    </div>
  );
}
