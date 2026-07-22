import { NavLink } from "react-router";

import {
  AgentsPreview,
  ChatPreview,
  FilesPreview,
  ProductScreenshot,
  TasksPreview,
} from "@/components/ProductPreview";
import { publicPageContainer } from "@/components/marketing/PublicPage";
import { Button } from "@/components/ui/button";
import { marketingCopy } from "@/content/marketingCopy";
import { BETA_ACCESS_EXTERNAL, BETA_ACCESS_HREF } from "@/lib/site";
import { posts } from "@/pages/Blog/data";
import { phases, type PhaseStatus } from "@/pages/Roadmap/data";

const capabilities = [
  "Spaces",
  "Chat",
  "Tasks",
  "Library",
  "Private files",
  "Agents",
];

const roadmapPreview: { status: PhaseStatus; label: string }[] = [
  { status: "available", label: "Shipped" },
  { status: "pilot", label: "In progress" },
  { status: "development", label: "Planned" },
];

function BetaAccessButton({ inverted = false }: { inverted?: boolean }) {
  return (
    <Button
      asChild
      size="lg"
      className={
        inverted
          ? "bg-background px-5 text-foreground hover:bg-background/85"
          : "px-5"
      }
    >
      {BETA_ACCESS_EXTERNAL ? (
        <a href={BETA_ACCESS_HREF} target="_blank" rel="noopener noreferrer">
          Request beta access
        </a>
      ) : (
        <NavLink to={BETA_ACCESS_HREF}>Request beta access</NavLink>
      )}
    </Button>
  );
}

function EditorialLink({ to, children }: { to: string; children: string }) {
  return (
    <NavLink
      to={to}
      className="inline-flex w-fit border-b border-foreground pb-1 text-sm font-medium text-foreground transition-opacity hover:opacity-65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </NavLink>
  );
}

export default function Home() {
  const copy = marketingCopy.home;

  return (
    <div className="pt-16">
      <section className="border-b border-border py-16 sm:py-20 lg:py-24">
        <div className={publicPageContainer}>
          <div className="max-w-5xl">
            <h1 className="text-balance text-5xl font-medium leading-[0.98] tracking-[-0.055em] text-foreground sm:text-6xl lg:text-7xl">
              {copy.heroTitle}
            </h1>
            <p className="mt-7 max-w-xl text-base leading-7 text-muted-foreground sm:text-lg">
              {copy.heroDescription}
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <BetaAccessButton />
              <Button asChild size="lg" variant="outline" className="px-5">
                <a href="#how-misty-works">How it works</a>
              </Button>
            </div>
          </div>

          <div className="mt-14 sm:mt-16">
            <ProductScreenshot
              src="/space-library-crop.webp"
              alt="Misty Space Library with shared project research and files"
              label="Space Library · Beta"
              eager
            />
          </div>
        </div>
      </section>

      <section className="border-b border-border">
        <div
          className={`${publicPageContainer} grid md:grid-cols-[1.1fr_1.9fr]`}
        >
          <p className="border-b border-border py-6 text-sm leading-6 text-muted-foreground md:border-b-0 md:border-r md:pr-10">
            {copy.proof}
          </p>
          <ul className="grid grid-cols-2 md:grid-cols-3">
            {capabilities.map((capability) => (
              <li
                key={capability}
                className="border-b border-border px-5 py-6 text-sm text-foreground last:border-b-0 md:border-b-0 md:border-l first:md:border-l-0"
              >
                {capability}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-label="Misty features">
        <article className="border-b border-border py-16 sm:py-24">
          <div
            className={`${publicPageContainer} grid gap-12 lg:grid-cols-[0.72fr_1.28fr] lg:items-start lg:gap-16`}
          >
            <div className="max-w-md lg:sticky lg:top-28">
              <p className="text-sm text-muted-foreground">
                {copy.features[0].label}
              </p>
              <h2 className="mt-4 text-balance text-4xl font-medium leading-[1.04] tracking-[-0.045em] text-foreground sm:text-5xl">
                {copy.features[0].title}
              </h2>
              <p className="mt-5 text-base leading-7 text-muted-foreground">
                {copy.features[0].description}
              </p>
            </div>
            <div className="grid gap-5">
              <ChatPreview />
              <TasksPreview />
            </div>
          </div>
        </article>

        <article className="border-b border-border py-16 sm:py-24">
          <div
            className={`${publicPageContainer} grid gap-12 lg:grid-cols-[1.25fr_0.75fr] lg:items-center lg:gap-16`}
          >
            <FilesPreview />
            <div className="max-w-md lg:order-last">
              <p className="text-sm text-muted-foreground">
                {copy.features[1].label}
              </p>
              <h2 className="mt-4 text-balance text-4xl font-medium leading-[1.04] tracking-[-0.045em] text-foreground sm:text-5xl">
                {copy.features[1].title}
              </h2>
              <p className="mt-5 text-base leading-7 text-muted-foreground">
                {copy.features[1].description}
              </p>
            </div>
          </div>
        </article>

        <article className="border-b border-border py-16 sm:py-24">
          <div
            className={`${publicPageContainer} grid gap-12 lg:grid-cols-[0.75fr_1.25fr] lg:items-center lg:gap-16`}
          >
            <div className="max-w-md">
              <p className="text-sm text-muted-foreground">
                {copy.features[2].label}
              </p>
              <h2 className="mt-4 text-balance text-4xl font-medium leading-[1.04] tracking-[-0.045em] text-foreground sm:text-5xl">
                {copy.features[2].title}
              </h2>
              <p className="mt-5 text-base leading-7 text-muted-foreground">
                {copy.features[2].description}
              </p>
            </div>
            <AgentsPreview />
          </div>
        </article>
      </section>

      <section
        id="how-misty-works"
        className="scroll-mt-24 border-b border-border py-16 sm:py-24"
      >
        <div className={publicPageContainer}>
          <div className="grid gap-8 lg:grid-cols-2 lg:gap-16">
            <h2 className="max-w-xl text-balance text-4xl font-medium leading-[1.04] tracking-[-0.045em] text-foreground sm:text-5xl">
              {copy.workflowTitle}
            </h2>
            <p className="max-w-lg text-base leading-7 text-muted-foreground">
              {copy.workflowDescription}
            </p>
          </div>
          <ol className="mt-14 grid border-t border-border md:grid-cols-3">
            {copy.workflow.map((step, index) => (
              <li
                key={step.title}
                className="border-b border-border py-8 md:border-b-0 md:border-l md:px-8 first:md:border-l-0 first:md:pl-0"
              >
                <span
                  className="text-sm text-muted-foreground"
                  aria-hidden="true"
                >
                  0{index + 1}
                </span>
                <h3 className="mt-10 text-xl font-medium tracking-[-0.02em] text-foreground">
                  {step.title}
                </h3>
                <p className="mt-3 max-w-sm text-sm leading-6 text-muted-foreground">
                  {step.description}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

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

            <div className="py-9 lg:pl-12">
              <div className="flex items-center justify-between gap-6">
                <h3 className="text-xl font-medium text-foreground">Blog</h3>
                <EditorialLink to="/blog">View blog</EditorialLink>
              </div>
              {posts[0] ? (
                <article className="mt-8 border-y border-border py-6">
                  <p className="text-sm text-muted-foreground">
                    {posts[0].date}
                  </p>
                  <h4 className="mt-4 max-w-lg text-2xl font-medium tracking-[-0.03em] text-foreground">
                    {posts[0].title}
                  </h4>
                  <p className="mt-4 max-w-lg text-sm leading-6 text-muted-foreground">
                    {posts[0].summary}
                  </p>
                </article>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <section className="bg-foreground py-16 text-background sm:py-20">
        <div
          className={`${publicPageContainer} grid gap-8 md:grid-cols-[1fr_auto] md:items-end`}
        >
          <div className="max-w-3xl">
            <h2 className="text-balance text-4xl font-medium leading-[1.04] tracking-[-0.045em] sm:text-5xl">
              {copy.ctaTitle}
            </h2>
            <p className="mt-5 max-w-xl text-base leading-7 text-background/65">
              {copy.ctaDescription}
            </p>
          </div>
          <BetaAccessButton inverted />
        </div>
      </section>
    </div>
  );
}
