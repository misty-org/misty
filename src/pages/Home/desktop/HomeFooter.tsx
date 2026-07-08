import { ArrowRight, FileText, Newspaper } from "lucide-react";
import { FaDiscord, FaGithub, FaXTwitter } from "react-icons/fa6";
import { Link } from "react-router-dom";
import { openExternalLink } from "../../../shared/openExternalLink";

type LatestPost = {
  date: string;
  tag: string;
  title: string;
};

type LatestChangelog = {
  changes: string[];
  date: string;
  summary: string;
  version: string;
};

type HomeFooterProps = {
  latestChangelog: LatestChangelog;
  latestPost: LatestPost | null;
};

const socialLinks = [
  { label: "Discord", href: "https://discord.gg/M3EQuWcFS", icon: FaDiscord },
  { label: "GitHub", href: "https://github.com/misty-org", icon: FaGithub },
  { label: "X", href: "https://x.com/mistysys", icon: FaXTwitter },
];

const floatingFooterClass =
  "grid min-h-0 min-w-0 items-center gap-1 overflow-hidden rounded-xl border border-white/[0.08] bg-[rgb(9_12_16_/_var(--misty-app-panel-opacity,0.82))] p-1.5 shadow-xl shadow-black/20 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] xl:col-span-12 xl:col-start-1 xl:row-start-7";
const dockCellClass =
  "group grid min-h-14 min-w-0 items-center rounded-lg px-3 py-2 text-left transition hover:bg-white/[0.045]";
const dockLinkClass =
  "group grid min-w-0 grid-cols-[18px_minmax(0,1fr)_18px] items-center gap-2 text-left";

export function HomeFooter({ latestChangelog, latestPost }: HomeFooterProps) {
  return (
    <footer className={floatingFooterClass}>
      <section className={dockCellClass}>
        {latestPost ? (
          <Link
            className={dockLinkClass}
            to="/changelog"
          >
            <Newspaper className="h-4 w-4 text-text-muted" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-text">{latestPost.title}</span>
              <span className="block truncate text-[11px] text-text-muted">{latestPost.tag} · {latestPost.date}</span>
            </span>
            <ArrowRight className="h-4 w-4 shrink-0 opacity-60 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
          </Link>
        ) : (
          <p className="text-sm text-text-muted">No news published yet.</p>
        )}
      </section>

      <section className={dockCellClass}>
        <Link
          className={dockLinkClass}
          to="/changelog"
        >
          <FileText className="h-4 w-4 text-text-muted" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-text">{latestChangelog.version}</span>
            <span className="block truncate text-[11px] text-text-muted">{latestChangelog.date}</span>
          </span>
          <ArrowRight className="h-4 w-4 shrink-0 opacity-60 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
        </Link>
      </section>

      <section className={`${dockCellClass} justify-items-center lg:justify-self-end`}>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {socialLinks.map(({ href, icon: Icon, label }) => (
            <button
              aria-label={label}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-transparent bg-transparent p-0 text-text-muted transition hover:border-white/[0.08] hover:bg-white/[0.045] hover:text-text"
              key={label}
              onClick={() => void openExternalLink(href)}
              title={label}
              type="button"
            >
              <Icon className="h-5 w-5" />
            </button>
          ))}
        </div>
      </section>
    </footer>
  );
}
