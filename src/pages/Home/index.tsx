import { ArrowRight } from "lucide-react";
import { NavLink } from "react-router";

import {
  ChatPreview,
  ConnectionsPreview,
  FilesPreview,
  MikaPreview,
  ProductScreenshot,
  TasksPreview,
} from "@/components/ProductPreview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BETA_ACCESS_EXTERNAL, BETA_ACCESS_HREF } from "@/lib/site";

function BetaAccessButton({ className }: { className?: string }) {
  return (
    <Button asChild size="lg" className={className}>
      {BETA_ACCESS_EXTERNAL ? (
        <a href={BETA_ACCESS_HREF} target="_blank" rel="noopener noreferrer">
          Join the beta
          <ArrowRight aria-hidden="true" />
        </a>
      ) : (
        <NavLink to={BETA_ACCESS_HREF}>
          Join the beta
          <ArrowRight aria-hidden="true" />
        </NavLink>
      )}
    </Button>
  );
}

export default function Home() {
  return (
    <div className="overflow-hidden">
      <section className="border-b border-border px-5 pb-20 pt-32 sm:px-8 sm:pb-24 sm:pt-36">
        <div className="mx-auto max-w-[1060px]">
          <div className="mx-auto max-w-3xl text-center">
            <Badge variant="outline" className="mb-5 rounded-full px-3 py-1 text-xs">
              Invite-only beta
            </Badge>
            <h1 className="text-balance text-4xl font-semibold tracking-[-0.05em] text-foreground sm:text-6xl lg:text-7xl lg:leading-[1.02]">
              Keep the whole project in one Space.
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-pretty text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
              Misty keeps members, chat, tasks, and shared files together. Private Files stay
              private until you add them.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <BetaAccessButton className="w-full rounded-full px-6 sm:w-auto" />
              <Button asChild size="lg" variant="outline" className="w-full rounded-full px-6 sm:w-auto">
                <NavLink to="/download">Download beta</NavLink>
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

      <section className="border-b border-border px-5 py-20 sm:px-8 sm:py-24">
        <div className="mx-auto max-w-7xl">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Spaces
            </p>
            <h2 className="mt-3 text-balance text-3xl font-semibold tracking-[-0.035em] text-foreground sm:text-5xl">
              Members, Chat, Tasks, and Library.
            </h2>
          </div>

          <div className="mt-10 grid gap-6 lg:grid-cols-2">
            <ChatPreview />
            <TasksPreview />
          </div>

          <div className="mt-8 grid grid-cols-2 border-y border-border text-sm sm:grid-cols-4">
            {["Members", "Chat", "Tasks", "Library"].map((item) => (
              <div
                key={item}
                className="border-border px-4 py-4 text-center font-medium text-foreground even:border-l sm:border-l sm:first:border-l-0"
              >
                {item}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-border px-5 py-20 sm:px-8 sm:py-24">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
            <div>
              <div className="mb-6">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Integrations
                </p>
                <h2 className="mt-3 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                  Connectors are in pilot.
                </h2>
                <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
                  Google Calendar is in pilot. Slack, Notion, and Discord are not generally
                  available.
                </p>
              </div>
              <ConnectionsPreview />
            </div>

            <div>
              <div className="mb-6">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Mika
                </p>
                <h2 className="mt-3 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                  Ask about the active Space.
                </h2>
                <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
                  Where enabled, Mika uses permitted Space context. The conversation stays private
                  to your account.
                </p>
              </div>
              <MikaPreview />
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-border px-5 py-20 sm:px-8 sm:py-24">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.58fr_1.42fr] lg:items-center lg:gap-16">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Private Files
            </p>
            <h2 className="mt-3 text-balance text-3xl font-semibold tracking-[-0.035em] text-foreground sm:text-4xl">
              Browse first. Share deliberately.
            </h2>
            <p className="mt-4 max-w-lg text-sm leading-6 text-muted-foreground">
              Browse local and connected storage, then choose what to add to a Space.
            </p>
            <Button asChild variant="outline" className="mt-6">
              <NavLink to="/features#private-files">View Files</NavLink>
            </Button>
          </div>
          <FilesPreview />
        </div>
      </section>

      <section className="px-5 py-20 sm:px-8 sm:py-24">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-balance text-3xl font-semibold tracking-[-0.04em] text-foreground sm:text-5xl">
            Request beta access.
          </h2>
          <div className="mt-7">
            <BetaAccessButton className="rounded-full px-6" />
          </div>
        </div>
      </section>
    </div>
  );
}
