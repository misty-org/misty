import type { ReactNode } from "react";
import { NavLink } from "react-router";

import { ChatPreview, ProductScreenshot, TasksPreview } from "@/components/ProductPreview";
import { Button } from "@/components/ui/button";
import { BETA_ACCESS_EXTERNAL, BETA_ACCESS_HREF } from "@/lib/site";

const workflowSteps = [
  ["Create a Space", "Invite the people working on the project."],
  ["Bring in the work", "Add the conversations, tasks, and files that matter."],
  ["Stay in context", "Pick up where the group left off."],
];

const principles = [
  ["Private by default", "Files stay private until you share them."],
  ["One shared context", "Chat, tasks, and Library stay together."],
  ["Mika, in context", "Ask across content you can already access."],
];

function BetaAccessButton({ className }: { className?: string }) {
  return (
    <Button asChild size="lg" className={className}>
      {BETA_ACCESS_EXTERNAL ? (
        <a href={BETA_ACCESS_HREF} target="_blank" rel="noopener noreferrer">
          Join the beta
        </a>
      ) : (
        <NavLink to={BETA_ACCESS_HREF}>Join the beta</NavLink>
      )}
    </Button>
  );
}

function SectionLabel({ children, inverted = false }: { children: ReactNode; inverted?: boolean }) {
  return (
    <p
      className={
        inverted
          ? "font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-showcase-foreground/55"
          : "font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground"
      }
    >
      {children}
    </p>
  );
}

export default function Home() {
  return (
    <div className="relative overflow-hidden">
      <div className="misty-page-field pointer-events-none absolute inset-0 -z-10" aria-hidden="true" />

      <section className="relative isolate mt-16 overflow-hidden border-b border-border bg-showcase px-6 pb-14 pt-16 text-showcase-foreground sm:px-10 sm:pb-20 sm:pt-20 lg:px-16">
        <div className="misty-hero-field absolute inset-0 -z-10" aria-hidden="true" />
        <div className="mx-auto max-w-6xl">
          <div className="max-w-3xl">
            <p className="mb-5 font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-showcase-foreground/55">
              Invite-only beta
            </p>
            <h1 className="text-balance text-5xl font-medium leading-[0.98] tracking-[-0.055em] text-showcase-foreground sm:text-7xl">
              One Space for the whole project.
            </h1>
            <p className="mt-6 max-w-lg text-pretty text-base leading-7 text-showcase-foreground/65 sm:text-lg">
              Chat, tasks, and files—together.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <BetaAccessButton className="w-full rounded-full bg-showcase-foreground px-6 text-showcase hover:bg-showcase-foreground/90 sm:w-auto" />
              <Button
                asChild
                size="lg"
                variant="outline"
                className="w-full rounded-full border-showcase-foreground/25 bg-transparent px-6 text-showcase-foreground shadow-none hover:bg-showcase-foreground/10 hover:text-showcase-foreground dark:bg-transparent sm:w-auto"
              >
                <a href="#how-misty-works">How it works</a>
              </Button>
            </div>
          </div>

          <div className="mt-12 sm:mt-16">
            <ProductScreenshot
              src="/space-library-crop.webp"
              alt="Misty Space Library with shared project research and files"
              label="Space Library · Beta"
              eager
            />
          </div>
        </div>
      </section>

      <section className="border-b border-border px-6 py-14 sm:px-10 sm:py-20 lg:px-16">
        <div className="mx-auto max-w-5xl">
          <div className="max-w-2xl">
            <SectionLabel>Inside a Space</SectionLabel>
            <h2 className="mt-3 text-balance text-3xl font-medium tracking-[-0.04em] text-foreground sm:text-5xl">
              Work without the tool shuffle.
            </h2>
          </div>

          <div className="mt-9 grid gap-6 lg:grid-cols-2">
            <figure>
              <ChatPreview />
              <figcaption className="mt-4 text-base font-medium text-foreground">
                Conversations stay with the project.
              </figcaption>
            </figure>
            <figure>
              <TasksPreview />
              <figcaption className="mt-4 text-base font-medium text-foreground">
                Everyone sees what moves next.
              </figcaption>
            </figure>
          </div>
        </div>
      </section>

      <section className="border-b border-border px-6 py-14 sm:px-10 sm:py-20 lg:px-16">
        <div className="mx-auto grid max-w-5xl gap-9 lg:grid-cols-[0.7fr_1.3fr] lg:items-center lg:gap-14">
          <div>
            <SectionLabel>Your files</SectionLabel>
            <h2 className="mt-3 text-balance text-3xl font-medium tracking-[-0.04em] text-foreground sm:text-5xl">
              Private until you share.
            </h2>
            <p className="mt-4 max-w-sm text-base leading-7 text-muted-foreground">
              Browse across storage, then add only what belongs in the Space.
            </p>
          </div>
          <ProductScreenshot
            src="/misty-browse.png"
            alt="Browsing local and connected files in Misty"
            label="Private Files · Beta"
          />
        </div>
      </section>

      <section
        id="how-misty-works"
        className="scroll-mt-24 border-b border-border px-6 py-14 sm:px-10 sm:py-20 lg:px-16"
      >
        <div className="mx-auto max-w-5xl">
          <SectionLabel>How it works</SectionLabel>
          <h2 className="mt-3 text-balance text-3xl font-medium tracking-[-0.04em] text-foreground sm:text-5xl">
            Start with a Space.
          </h2>

          <ol className="mt-10 grid gap-8 sm:grid-cols-3">
            {workflowSteps.map(([title, description], index) => (
              <li key={title} className="border-t border-border pt-4">
                <span className="font-mono text-xs text-muted-foreground" aria-hidden="true">
                  0{index + 1}
                </span>
                <h3 className="mt-6 text-lg font-medium tracking-[-0.02em] text-foreground">{title}</h3>
                <p className="mt-2 max-w-xs text-sm leading-6 text-muted-foreground">{description}</p>
              </li>
            ))}
          </ol>

          <dl className="mt-12 grid border-y border-border sm:grid-cols-3">
            {principles.map(([title, description], index) => (
              <div
                key={title}
                className={`py-5 sm:px-6 ${index === 0 ? "sm:pl-0" : "border-t border-border sm:border-l sm:border-t-0"}`}
              >
                <dt className="text-sm font-medium text-foreground">{title}</dt>
                <dd className="mt-1 text-sm leading-6 text-muted-foreground">{description}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="px-6 py-14 sm:px-10 sm:py-20 lg:px-16">
        <div className="relative isolate mx-auto max-w-5xl overflow-hidden rounded-3xl bg-showcase px-6 py-12 text-showcase-foreground sm:px-10 sm:py-16">
          <div className="misty-cta-field absolute inset-0 -z-10" aria-hidden="true" />
          <div className="max-w-xl">
            <SectionLabel inverted>Invite-only beta</SectionLabel>
            <h2 className="mt-3 text-balance text-3xl font-medium tracking-[-0.04em] text-showcase-foreground sm:text-5xl">
              Bring your next project.
            </h2>
            <div className="mt-7">
              <BetaAccessButton className="rounded-full bg-showcase-foreground px-6 text-showcase hover:bg-showcase-foreground/90" />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
