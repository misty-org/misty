import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { posts, tagColors } from "./data";

export default function Blog() {
  return (
    <div className="max-w-5xl mx-auto px-3 sm:px-4 pt-32 pb-20">
      <div className="mb-12">
        <h1 className="mb-4 text-3xl font-bold text-foreground md:text-5xl">
          Blog
        </h1>
        <p className="leading-relaxed text-muted-foreground">
          Updates, deep dives, and behind-the-scenes from the Misty team.
        </p>
      </div>

      <div className="flex flex-col gap-6">
        {posts.map((post) => (
          <Card
            key={post.title}
            role="article"
            className="group gap-0 rounded-xl py-0 transition-colors hover:bg-muted/30"
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
              <h2 className="mb-2 text-lg font-semibold text-foreground transition-colors group-hover:text-primary">
                {post.title}
              </h2>
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
