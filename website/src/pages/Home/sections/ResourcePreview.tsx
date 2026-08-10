import { NavLink } from "react-router";

import { posts } from "@/pages/Blog/data";
import { changelog } from "@/pages/Changelog/data";
import { phases, type PhaseStatus } from "@/pages/Roadmap/data";
import { useReveal } from "@/hooks/useReveal";

const roadmapOrder: PhaseStatus[] = ["development", "pilot", "available"];

const roadmapLabels: Record<PhaseStatus, string> = {
  development: "Planned",
  pilot: "In progress",
  available: "Shipped",
};

const previewLinkClass =
  "text-sm font-medium text-[var(--marketing-foreground)] transition-colors hover:text-[var(--marketing-muted)]";

function BlogPreview() {
  const ref = useReveal<HTMLElement>();
  const post = posts[0];

  if (!post) return null;

  return (
    <section ref={ref} aria-labelledby="blog-preview-title" className="reveal py-3 sm:py-4">
      <div className="mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-12">
        <div className="grid overflow-hidden rounded-xl border border-[var(--marketing-border)] bg-[var(--marketing-surface)] lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
          <article className="p-6 sm:p-8 lg:p-10">
            <div className="flex items-center justify-between gap-6">
              <h2 id="blog-preview-title" className="text-xl font-medium tracking-[-0.025em] text-[var(--marketing-foreground)] sm:text-2xl">
                Blog
              </h2>
              <NavLink to="/blog" className={previewLinkClass}>
                View all
              </NavLink>
            </div>
            <h3 className="mt-16 max-w-3xl text-balance text-3xl font-medium tracking-[-0.04em] text-[var(--marketing-foreground)] sm:text-5xl">
              {post.title}
            </h3>
            <p className="mt-6 max-w-2xl text-base leading-relaxed text-[var(--marketing-muted)] sm:text-lg">
              {post.summary}
            </p>
          </article>
          <aside className="flex flex-col justify-between border-t border-[var(--marketing-border)] p-6 sm:p-8 lg:border-l lg:border-t-0 lg:p-10">
            <div>
              <span className="inline-flex rounded-full border border-[var(--marketing-border-strong)] px-3 py-1 text-sm text-[var(--marketing-foreground)]">
                {post.tag}
              </span>
              <p className="mt-5 text-base text-[var(--marketing-muted)]">{post.date}</p>
            </div>
            {post.historicalContext ? (
              <p className="border-t border-[var(--marketing-border)] pt-5 text-sm leading-relaxed text-[var(--marketing-muted)]">
                Archived: {post.historicalContext}
              </p>
            ) : null}
          </aside>
        </div>
      </div>
    </section>
  );
}

function ChangelogPreview() {
  const ref = useReveal<HTMLElement>();
  const entry = changelog[0];

  if (!entry) return null;

  return (
    <section ref={ref} aria-labelledby="changelog-preview-title" className="reveal py-3 sm:py-4">
      <div className="mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-12">
        <div className="overflow-hidden rounded-xl border border-[var(--marketing-border)] bg-[var(--marketing-surface)]">
          <div className="flex items-center justify-between border-b border-[var(--marketing-border)] px-6 py-5 sm:px-8 lg:px-10">
            <h2 id="changelog-preview-title" className="text-xl font-medium tracking-[-0.025em] text-[var(--marketing-foreground)] sm:text-2xl">
              Changelog
            </h2>
            <NavLink to="/changelog" className={previewLinkClass}>
              View all
            </NavLink>
          </div>
          <div className="grid lg:grid-cols-[0.75fr_1.25fr_1fr]">
            <div className="border-b border-[var(--marketing-border)] p-6 sm:p-8 lg:border-b-0 lg:border-r lg:p-10">
              <span className="inline-flex rounded-full border border-[var(--marketing-border-strong)] px-3 py-1 text-sm text-[var(--marketing-foreground)]">
                {entry.version}
              </span>
              <p className="mt-5 max-w-40 text-base leading-relaxed text-[var(--marketing-muted)]">
                {entry.date}
              </p>
            </div>
            <article className="border-b border-[var(--marketing-border)] p-6 sm:p-8 lg:border-b-0 lg:border-r lg:p-10">
              <h3 className="text-balance text-2xl font-medium tracking-[-0.035em] text-[var(--marketing-foreground)] sm:text-3xl">
                {entry.summary}
              </h3>
              <p className="mt-5 text-base leading-relaxed text-[var(--marketing-muted)]">
                {entry.groups[0]?.changes[0]}
              </p>
            </article>
            <div className="divide-y divide-[var(--marketing-border)]">
              {entry.groups.slice(1, 3).map((group) => (
                <div key={group.heading} className="p-6 sm:p-8 lg:p-10">
                  <h3 className="text-sm font-medium text-[var(--marketing-foreground)]">
                    {group.heading}
                  </h3>
                  <p className="mt-3 text-sm leading-relaxed text-[var(--marketing-muted)]">
                    {group.changes[0]}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function RoadmapPreview() {
  const ref = useReveal<HTMLElement>();

  return (
    <section ref={ref} aria-labelledby="roadmap-preview-title" className="reveal py-3 sm:py-4">
      <div className="mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-12">
        <div className="overflow-hidden rounded-xl border border-[var(--marketing-border)] bg-[var(--marketing-surface)]">
          <div className="flex items-center justify-between border-b border-[var(--marketing-border)] px-6 py-5 sm:px-8 lg:px-10">
            <h2 id="roadmap-preview-title" className="text-xl font-medium tracking-[-0.025em] text-[var(--marketing-foreground)] sm:text-2xl">
              Roadmap
            </h2>
            <NavLink to="/roadmap" className={previewLinkClass}>
              View all
            </NavLink>
          </div>
          <div className="grid gap-px bg-[var(--marketing-border)] md:grid-cols-3">
            {roadmapOrder.map((status) => {
              const phase = phases.find((item) => item.status === status);

              return (
                <article key={status} className="min-h-64 bg-[var(--marketing-surface)] p-6 sm:p-8 lg:p-10">
                  <p className="text-sm text-[var(--marketing-muted)]">{roadmapLabels[status]}</p>
                  <div className="mt-10 space-y-4">
                    {phase?.items.slice(0, 2).map((item) => (
                      <div key={item.title}>
                        <h3 className="text-lg font-medium tracking-[-0.02em] text-[var(--marketing-foreground)]">
                          {item.title}
                        </h3>
                        <p className="mt-2 text-sm leading-relaxed text-[var(--marketing-muted)]">
                          {item.description}
                        </p>
                      </div>
                    ))}
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

export function ResourcePreview() {
  return (
    <>
      <BlogPreview />
      <ChangelogPreview />
      <RoadmapPreview />
    </>
  );
}
