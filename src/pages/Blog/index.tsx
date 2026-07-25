import { PageHeader, PublicPage, ResourceNav } from "@/components/marketing";
import { Badge } from "@/components/ui/badge";
import { marketingCopy } from "@/content/marketingCopy";
import { posts, tagColors } from "./data";

export default function Blog() {
  return (
    <PublicPage>
      <PageHeader label="Blog" title={marketingCopy.blog.title} description={marketingCopy.blog.description} />
      <ResourceNav />

      <div>
        {posts.map((post) => (
          <article key={post.title} className="grid gap-5 border-b border-border py-10 sm:grid-cols-[10rem_1fr] sm:gap-12">
            <div>
              <Badge variant="outline" className={tagColors[post.tag] ?? "text-muted-foreground"}>
                {post.tag}
              </Badge>
              <p className="mt-3 text-xs text-muted-foreground">{post.date}</p>
            </div>
            <div className="max-w-2xl">
              <h2 className="text-2xl font-medium tracking-[-0.03em] text-foreground">{post.title}</h2>
              <p className="mt-4 text-sm leading-6 text-muted-foreground">{post.summary}</p>
              {post.historicalContext ? (
                <p className="mt-4 border-l-2 border-border pl-4 text-xs leading-5 text-muted-foreground">
                  Archived: {post.historicalContext}
                </p>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </PublicPage>
  );
}
