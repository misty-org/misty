import { publicPageContainer } from "@/components/marketing";
import type { MarketingCopy } from "@/content/marketingCopy";
import { posts } from "@/pages/Blog/data";
import { phases } from "@/pages/Roadmap/data";
import { EditorialLink } from "../components/EditorialLink";
import { roadmapPreview } from "../data";

function RoadmapDigest() {
  return (
    <div className="border-b border-border py-9 lg:border-b-0 lg:border-r lg:pr-12">
      <div className="flex items-center justify-between gap-6">
        <h3 className="text-xl font-medium text-foreground">Roadmap</h3>
        <EditorialLink to="/roadmap">View roadmap</EditorialLink>
      </div>
      <div className="mt-8 divide-y divide-border border-y border-border">
        {roadmapPreview.map(({ status, label }) => {
          const phase = phases.find((item) => item.status === status);
          return (
            <div
              key={status}
              className="grid grid-cols-[7rem_1fr] gap-5 py-4 text-sm"
            >
              <span className="text-muted-foreground">{label}</span>
              <span className="text-foreground">
                {phase?.items[0]?.title ?? "Misty"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BlogDigest() {
  return (
    <div className="py-9 lg:pl-12">
      <div className="flex items-center justify-between gap-6">
        <h3 className="text-xl font-medium text-foreground">Blog</h3>
        <EditorialLink to="/blog">View blog</EditorialLink>
      </div>
      {posts[0] ? (
        <article className="mt-8 border-y border-border py-6">
          <p className="text-sm text-muted-foreground">{posts[0].date}</p>
          <h4 className="mt-4 max-w-lg text-2xl font-medium tracking-[-0.03em] text-foreground">
            {posts[0].title}
          </h4>
          <p className="mt-4 max-w-lg text-sm leading-6 text-muted-foreground">
            {posts[0].summary}
          </p>
        </article>
      ) : null}
    </div>
  );
}

export function Updates({ copy }: { copy: MarketingCopy["home"] }) {
  return (
    <section className="border-b border-border py-16 sm:py-24">
      <div className={publicPageContainer}>
        <div className="grid gap-8 lg:grid-cols-2 lg:gap-16">
          <h2 className="max-w-xl text-balance text-4xl font-medium leading-[1.04] tracking-[-0.045em] text-foreground sm:text-5xl">
            {copy.updatesTitle}
          </h2>
          <p className="max-w-lg text-base leading-7 text-muted-foreground">
            {copy.updatesDescription}
          </p>
        </div>

        <div className="mt-14 grid border-t border-border lg:grid-cols-2">
          <RoadmapDigest />
          <BlogDigest />
        </div>
      </div>
    </section>
  );
}
