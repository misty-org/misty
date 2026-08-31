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
  "text-xs font-medium text-[var(--marketing-muted)] transition-colors hover:text-[var(--marketing-foreground)] focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function PreviewHeader({
  id,
  label,
  to,
}: {
  id: string;
  label: string;
  to: string;
}) {
  return (
    <div className="flex items-center justify-between gap-6 border-b border-[var(--marketing-border)] px-5 py-4 sm:px-6">
      <h2
        id={id}
        className="text-base font-medium tracking-[-0.02em] text-[var(--marketing-foreground)] sm:text-lg"
      >
        {label}
      </h2>
      <NavLink to={to} className={previewLinkClass}>
        View all
      </NavLink>
    </div>
  );
}

function BlogPreview() {
  const ref = useReveal<HTMLElement>();
  const post = posts[0];

  if (!post) return null;

  return (
    <section
      ref={ref}
      aria-labelledby="blog-preview-title"
      className="reveal"
      data-resource-preview="blog"
    >
      <div className="site-container">
        <div className="overflow-hidden rounded-xl border border-[var(--marketing-border)] bg-[var(--marketing-surface)]">
          <PreviewHeader id="blog-preview-title" label="Blog" to="/blog" />
          <div className="grid lg:grid-cols-[minmax(0,1.45fr)_minmax(17rem,0.55fr)]">
            <article className="p-5 sm:p-6">
              <h3 className="max-w-3xl text-balance text-xl font-medium tracking-[-0.03em] text-[var(--marketing-foreground)] sm:text-2xl lg:text-3xl">
                {post.title}
              </h3>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--marketing-muted)]">
                {post.summary}
              </p>
            </article>
            <aside className="border-t border-[var(--marketing-border)] p-5 sm:p-6 lg:border-l lg:border-t-0">
              <div className="flex flex-wrap items-center gap-3">
                <span className="inline-flex rounded-full border border-[var(--marketing-border-strong)] px-2.5 py-1 text-xs text-[var(--marketing-foreground)]">
                  {post.tag}
                </span>
                <p className="text-sm text-[var(--marketing-muted)]">
                  {post.date}
                </p>
              </div>
              {post.historicalContext ? (
                <p className="mt-5 border-t border-[var(--marketing-border)] pt-4 text-xs leading-5 text-[var(--marketing-muted)]">
                  Archived: {post.historicalContext}
                </p>
              ) : null}
            </aside>
          </div>
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
    <section
      ref={ref}
      aria-labelledby="changelog-preview-title"
      className="reveal"
      data-resource-preview="changelog"
    >
      <div className="site-container">
        <div className="overflow-hidden rounded-xl border border-[var(--marketing-border)] bg-[var(--marketing-surface)]">
          <PreviewHeader
            id="changelog-preview-title"
            label="Changelog"
            to="/changelog"
          />
          <div className="grid lg:grid-cols-[0.55fr_1.25fr_1.2fr]">
            <div className="border-b border-[var(--marketing-border)] p-5 sm:p-6 lg:border-b-0 lg:border-r">
              <span className="inline-flex rounded-full border border-[var(--marketing-border-strong)] px-2.5 py-1 text-xs text-[var(--marketing-foreground)]">
                {entry.version}
              </span>
              <p className="mt-3 max-w-40 text-sm leading-5 text-[var(--marketing-muted)]">
                {entry.date}
              </p>
            </div>
            <article className="border-b border-[var(--marketing-border)] p-5 sm:p-6 lg:border-b-0 lg:border-r">
              <h3 className="text-balance text-xl font-medium tracking-[-0.03em] text-[var(--marketing-foreground)] sm:text-2xl">
                {entry.summary}
              </h3>
              <p className="mt-3 text-sm leading-6 text-[var(--marketing-muted)]">
                {entry.groups[0]?.changes[0]}
              </p>
            </article>
            <div className="divide-y divide-[var(--marketing-border)]">
              {entry.groups.slice(1, 3).map((group) => (
                <div key={group.heading} className="p-5 sm:p-6">
                  <h3 className="text-xs font-medium text-[var(--marketing-foreground)]">
                    {group.heading}
                  </h3>
                  <p className="mt-2 text-xs leading-5 text-[var(--marketing-muted)]">
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
    <section
      ref={ref}
      aria-labelledby="roadmap-preview-title"
      className="reveal"
      data-resource-preview="roadmap"
    >
      <div className="site-container">
        <div className="overflow-hidden rounded-xl border border-[var(--marketing-border)] bg-[var(--marketing-surface)]">
          <PreviewHeader
            id="roadmap-preview-title"
            label="Roadmap"
            to="/roadmap"
          />
          <div className="grid gap-px bg-[var(--marketing-border)] md:grid-cols-3">
            {roadmapOrder.map((status) => {
              const phase = phases.find((item) => item.status === status);

              return (
                <article
                  key={status}
                  className="bg-[var(--marketing-surface)] p-5 sm:p-6"
                >
                  <p className="text-xs text-[var(--marketing-muted)]">
                    {roadmapLabels[status]}
                  </p>
                  <div className="mt-5 space-y-4">
                    {phase?.items.slice(0, 2).map((item) => (
                      <div key={item.title}>
                        <h3 className="text-base font-medium tracking-[-0.02em] text-[var(--marketing-foreground)]">
                          {item.title}
                        </h3>
                        <p className="mt-1.5 text-xs leading-5 text-[var(--marketing-muted)]">
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
    <div className="grid gap-8 py-8">
      <BlogPreview />
      <ChangelogPreview />
      <RoadmapPreview />
    </div>
  );
}
