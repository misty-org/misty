import { NavLink } from "react-router";
import { posts, tagColors } from "../Blog/data";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

export default function BlogPreview() {
  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-3xl md:text-4xl font-bold text-foreground tracking-tight">
          Blog
        </h2>
        <NavLink
          to="/blog"
          className="group flex items-center gap-1.5 rounded-sm text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          View all posts
          <span className="group-hover:translate-x-1 transition-transform duration-300">
            &rarr;
          </span>
        </NavLink>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {posts.map((post) => (
          <article key={post.title}>
            <Card>
              <CardContent className="flex flex-col p-8">
            <div className="flex items-center gap-3 mb-4">
              <Badge
                variant="outline"
                className={tagColors[post.tag] ?? "bg-muted text-muted-foreground"}
              >
                {post.tag}
              </Badge>
              <span className="text-xs text-muted-foreground">{post.date}</span>
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-3">
              {post.title}
            </h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {post.summary}
            </p>
              </CardContent>
            </Card>
          </article>
        ))}
      </div>
    </div>
  );
}
