import { ArrowRight, FileText, Sparkles } from "lucide-react";
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
  "grid min-h-0 min-w-0 gap-2 overflow-hidden rounded-2xl border border-white/[0.08] bg-[#090c10]/85 p-2 shadow-2xl shadow-black/35 backdrop-blur-xl lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] xl:col-span-12 xl:col-start-1 xl:row-start-7";
const dockCellClass =
  "group min-w-0 rounded-xl px-3 py-2.5 text-left transition hover:bg-white/[0.045]";
const dockLabelClass =
  "mb-1.5 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-normal text-text-muted";

export function HomeFooter({ latestChangelog, latestPost }: HomeFooterProps) {
  return (
    <footer className={floatingFooterClass}>
      <section className={dockCellClass}>
        <div className={dockLabelClass}>
          <Sparkles className="h-3.5 w-3.5" />
          Latest news
        </div>
        {latestPost ? (
          <Link
            className="group grid min-w-0 gap-1 text-left"
            to="/changelog"
          >
            <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-text transition">
              <span className="truncate">{latestPost.title}</span>
              <ArrowRight className="h-4 w-4 shrink-0 opacity-60 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
            </span>
            <span className="line-clamp-1 text-xs leading-5 text-text-muted">
              {latestPost.tag} · {latestPost.date}
            </span>
          </Link>
        ) : (
          <p className="text-sm text-text-muted">No news published yet.</p>
        )}
      </section>

      <section className={dockCellClass}>
        <div className={dockLabelClass}>
          <FileText className="h-3.5 w-3.5" />
          Release
        </div>
        <Link
          className="group grid min-w-0 gap-1 text-left"
          to="/changelog"
        >
          <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-text transition">
            <span className="truncate">
              {latestChangelog.version} · {latestChangelog.summary}
            </span>
            <ArrowRight className="h-4 w-4 shrink-0 opacity-60 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
          </span>
          <span className="line-clamp-1 text-xs leading-5 text-text-muted">
            {latestChangelog.date} ·{" "}
            {latestChangelog.changes[0] ?? "View all release notes"}
          </span>
        </Link>
      </section>

      <section className={`${dockCellClass} lg:justify-self-end lg:text-right`}>
        <div className={`${dockLabelClass} lg:justify-end`}>
          Community
        </div>
        <div className="flex flex-wrap items-center gap-4 lg:justify-end">
          {socialLinks.map(({ href, icon: Icon, label }) => (
            <button
              aria-label={label}
              className="inline-flex h-7 w-7 items-center justify-center border-0 bg-transparent p-0 text-text-muted transition hover:text-text"
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
