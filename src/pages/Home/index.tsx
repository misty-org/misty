import { useEffect, useState } from "react";
import {
  SiDiscord,
  SiGooglecalendar,
  SiNotion,
  SiSlack,
} from "react-icons/si";
import { NavLink } from "react-router";

import {
  AgentBuilderPreview,
  AgentsPreview,
  ChatPreview,
  FilesPreview,
  ProductScreenshot,
  SharedLibraryPreview,
  TasksPreview,
} from "@/components/ProductPreview";
import { publicPageContainer } from "@/components/marketing/PublicPage";
import { Button } from "@/components/ui/button";
import { marketingCopy, type MarketingCopy } from "@/content/marketingCopy";
import { BETA_ACCESS_EXTERNAL, BETA_ACCESS_HREF } from "@/lib/site";
import { cn } from "@/lib/utils";
import { posts } from "@/pages/Blog/data";
import { phases, type PhaseStatus } from "@/pages/Roadmap/data";

const capabilities = [
  { name: "Agents", description: "Custom AI on Space context." },
  { name: "Spaces", description: "One shared home for the group." },
  { name: "Chat", description: "Conversation beside the work." },
  { name: "Tasks", description: "Boards, owners, and priorities." },
  { name: "Library", description: "Shared files and references." },
  { name: "Private files", description: "Local and connected, still yours." },
];

const connections = [
  { name: "Google Calendar", Mark: SiGooglecalendar, status: "In pilot" },
  { name: "Slack", Mark: SiSlack, status: "Coming" },
  { name: "Notion", Mark: SiNotion, status: "Coming" },
  { name: "Discord", Mark: SiDiscord, status: "Coming" },
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

const TYPE_MS = 125;
const DELETE_MS = 55;
const HOLD_MS = 3000;

function usePrefersReducedMotion() {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches,
  );

  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = () => setReduced(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  return reduced;
}

/**
 * Types each phrase in, holds, deletes, and moves to the next. When disabled it
 * rests on the first phrase, fully typed — the CSS reduced-motion rule in
 * index.css cannot stop a JS timer, so that case is handled here instead.
 */
function useTypedPhrase(phrases: readonly string[], enabled: boolean) {
  const [index, setIndex] = useState(0);
  const [length, setLength] = useState(phrases[0].length);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!enabled) return;

    const phrase = phrases[index];
    const settled = !deleting && length === phrase.length;
    const timer = window.setTimeout(
      () => {
        if (deleting) {
          if (length === 0) {
            setDeleting(false);
            setIndex((current) => (current + 1) % phrases.length);
          } else {
            setLength(length - 1);
          }
        } else if (settled) {
          setDeleting(true);
        } else {
          setLength(length + 1);
        }
      },
      settled ? HOLD_MS : deleting ? DELETE_MS : TYPE_MS,
    );

    return () => window.clearTimeout(timer);
  }, [enabled, phrases, index, length, deleting]);

  return phrases[index].slice(0, length);
}

/**
 * "Space" in the hero, rendered as a link to the Spaces explainer.
 * The resting underline is a static bar so the affordance survives the global
 * `animation: none` under prefers-reduced-motion (see src/index.css).
 */
function SpacesLink({ children }: { children: string }) {
  return (
    <NavLink
      to="/features#spaces"
      className="relative inline-block rounded-sm transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background"
    >
      {children}
      <span
        aria-hidden="true"
        className="absolute inset-x-0 bottom-[0.06em] h-[0.055em] overflow-hidden rounded-full"
      >
        <span className="absolute inset-0 bg-foreground/45" />
        <span className="absolute inset-0 animate-[underline-sweep_3.2s_ease-in-out_infinite] bg-foreground" />
      </span>
    </NavLink>
  );
}

const headlineType =
  "text-5xl font-medium leading-[0.98] tracking-[-0.055em] text-foreground sm:text-6xl lg:text-7xl";

function HeroHeadline({
  heroTitle,
}: {
  heroTitle: MarketingCopy["home"]["heroTitle"];
}) {
  const { before, link, after, phrases } = heroTitle;
  const reducedMotion = usePrefersReducedMotion();
  const typed = useTypedPhrase(phrases, !reducedMotion);

  // The tallest phrase reserves the row so the hero never reflows mid-cycle.
  const longest = phrases.reduce((a, b) => (b.length > a.length ? b : a));

  return (
    <div className="grid">
      <span
        aria-hidden="true"
        className={`invisible col-start-1 row-start-1 ${headlineType}`}
      >
        {before}
        {link}
        {after}
        {longest}
      </span>
      <h1 className={`col-start-1 row-start-1 ${headlineType}`}>
        {before}
        <SpacesLink>{link}</SpacesLink>
        {after}
        {/* Stable accessible name; the animated copy below is decorative. */}
        <span className="sr-only">{phrases[0]}</span>
        <span aria-hidden="true">
          {typed}
          {reducedMotion ? null : (
            <span className="ml-[0.06em] inline-block h-[0.78em] w-[0.055em] translate-y-[0.06em] animate-[caret-blink_1.1s_steps(1)_infinite] bg-foreground align-baseline" />
          )}
        </span>
      </h1>
    </div>
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
            <HeroHeadline heroTitle={copy.heroTitle} />
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
              alt="Misty Space Library with shared research and files"
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
            {capabilities.map((capability, index) => (
              <li
                key={capability.name}
                className={cn(
                  "border-border px-5 py-6",
                  index % 2 === 1 && "border-l",
                  index < 4 && "border-b",
                  index % 3 === 0 ? "md:border-l-0" : "md:border-l",
                  index >= 3 && "md:border-b-0",
                )}
              >
                <p className="text-sm font-medium text-foreground">
                  {capability.name}
                </p>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  {capability.description}
                </p>
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
              <AgentsPreview />
              <AgentBuilderPreview />
            </div>
          </div>
        </article>

        <article className="border-b border-border py-16 sm:py-24">
          <div
            className={`${publicPageContainer} grid gap-12 lg:grid-cols-[1.28fr_0.72fr] lg:items-start lg:gap-16`}
          >
            <div className="max-w-md lg:sticky lg:top-28 lg:order-last">
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
            <div className="grid gap-5 lg:order-first">
              <ChatPreview />
              <TasksPreview />
            </div>
          </div>
        </article>

        <article className="border-b border-border py-16 sm:py-24">
          <div
            className={`${publicPageContainer} grid gap-12 lg:grid-cols-[0.72fr_1.28fr] lg:items-start lg:gap-16`}
          >
            <div className="max-w-md lg:sticky lg:top-28">
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
            <div className="grid gap-5">
              <FilesPreview />
              <SharedLibraryPreview />
            </div>
          </div>
        </article>
      </section>

      <section
        aria-label="Connections"
        className="border-b border-border py-14 sm:py-16"
      >
        <div
          className={`${publicPageContainer} grid gap-10 lg:grid-cols-[0.9fr_2.1fr] lg:items-center lg:gap-16`}
        >
          <div className="max-w-sm">
            <h2 className="text-balance text-xl font-medium tracking-[-0.02em] text-foreground">
              Works with the tools your group already uses.
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Connections are rolling out through the beta. Current status is
              listed for each.
            </p>
          </div>
          <ul className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-4">
            {connections.map(({ name, Mark, status }) => (
              <li key={name} className="flex flex-col gap-3">
                <Mark
                  className="size-7 text-foreground/75"
                  aria-hidden="true"
                />
                <div>
                  <p className="text-sm font-medium text-foreground">{name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{status}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
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
