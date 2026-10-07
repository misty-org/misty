import React from "react";
import { createRoot } from "react-dom/client";
import { ArrowUpRight } from "lucide-react";
import { Button } from "@/shared/ui";
import "@fontsource-variable/inter";
import "@/styles/styles.css";
import "./preview.css";

const production = [
  ["production-desktop.jpg", "Production · Compact chat and revised sidebar"],
  ["production-switcher.jpg", "Production · Conversation switcher"],
  ["production-all-yours.jpg", "Production · Yours"],
  ["production-all-suggested.jpg", "Production · Suggested"],
  ["production-all-favorites.jpg", "Production · Favorites"],
  ["production-edit.jpg", "Production · Inline editing"],
  ["production-narrow.jpg", "Production · Narrow workspace"],
];
const desktop = [
  ["chat-desktop.jpg", "Conversation"],
  ["chat-switcher.jpg", "Switch conversations"],
  ["chat-reply.jpg", "Reply with an attachment"],
  ["chat-reaction-picker.jpg", "Add a reaction"],
  ["chat-message-menu.jpg", "Message actions"],
  ["chat-edit.jpg", "Edit inline"],
  ["chat-delete.jpg", "Delete confirmation"],
  ["all-yours.jpg", "All · Yours"],
  ["all-suggested.jpg", "All · Suggested"],
  ["all-favorites.jpg", "All · Favorites"],
  ["chat-narrow.jpg", "A narrower workspace"],
  ["all-narrow-grid.jpg", "Collection grid"],
];
function capture(file: string) {
  return new URL(`./screenshots/${file}`, import.meta.url).href;
}
function Figures({ entries }: { entries: string[][] }) {
  return (
    <>
      {entries.map(([file, title]) => (
        <figure key={file}>
          <a href={capture(file)} target="_blank" rel="noreferrer">
            <img
              className="w-full rounded-lg border border-charcoal-border"
              src={capture(file)}
              alt={title}
              loading="lazy"
            />
          </a>
          <figcaption className="mt-3 text-sm font-medium">{title}</figcaption>
        </figure>
      ))}
    </>
  );
}
function Gallery() {
  return (
    <main className="mx-auto max-w-[1520px] p-6 md:p-12">
      <header className="mb-12 flex flex-wrap items-start justify-between gap-6">
        <div>
          <h1 className="text-2xl font-semibold">Spaces, closer together</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-cream-muted">
            Production components with fixture data, plus the original design studies. Preview
            changes stay in memory and never touch live accounts.
          </p>
        </div>
        <Button variant="primary" asChild>
          <a href="/production.html">
            Open production component preview
            <ArrowUpRight />
          </a>
        </Button>
      </header>
      <div className="mb-10 flex flex-wrap gap-2">
        {[
          ["/", "Original prototype"],
          ["/?view=all", "All · Yours"],
          ["/?view=all&filter=Suggested", "Suggested"],
          ["/?view=all&filter=Favorites", "Favorites"],
          ["/?state=empty", "Empty state"],
          ["/?state=read-only", "Read only"],
          ["/?state=failed", "Failed send"],
        ].map(([href, label]) => (
          <Button key={href} variant="outline" size="sm" asChild>
            <a href={href}>{label}</a>
          </Button>
        ))}
      </div>
      <div className="grid gap-x-6 gap-y-10 lg:grid-cols-2">
        <Figures entries={production} />
      </div>
      <h2 className="mb-6 mt-16 text-xl font-medium">Original design studies</h2>
      <p className="mb-6 text-sm text-cream-muted">
        Historical captures below predate the refined reply connector and hover-only toolbar.
      </p>
      <div className="grid gap-x-6 gap-y-10 lg:grid-cols-2">
        <Figures entries={desktop} />
      </div>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Gallery />);
