import { ArrowRight, FileText, Newspaper } from "lucide-react";
import { FaGithub, FaXTwitter } from "react-icons/fa6";
import { Link } from "react-router-dom";
import { openExternalLink } from "../../../shared/openExternalLink";
import { Button } from "../../../components/ui/button";

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
  { label: "GitHub", href: "https://github.com/misty-org", icon: FaGithub },
  { label: "X", href: "https://x.com/mistysys", icon: FaXTwitter },
];

const floatingFooterClass =
  "grid min-w-0 shrink-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-1 overflow-hidden rounded-lg bg-muted/25 p-1.5 max-[760px]:grid-cols-1";
const dockCellClass =
  "group grid min-h-14 min-w-0 items-center rounded-md px-3 py-2 text-left transition-colors hover:bg-muted/60";
const dockLinkClass =
  "group grid h-full w-full min-w-0 grid-cols-[18px_minmax(0,1fr)_18px] items-center gap-2 text-left";

export function HomeFooter({ latestChangelog, latestPost }: HomeFooterProps) {
  return (
    <footer aria-label="Home resources" className={floatingFooterClass}>
      <section aria-label="Latest news" className={dockCellClass}>
        {latestPost ? (
          <Link
            className={dockLinkClass}
            to="/changelog"
          >
            <Newspaper className="h-4 w-4 text-muted-foreground" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-foreground">{latestPost.title}</span>
              <span className="block truncate text-[11px] text-muted-foreground">{latestPost.tag} · {latestPost.date}</span>
            </span>
            <ArrowRight className="h-4 w-4 shrink-0 opacity-60 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
          </Link>
        ) : (
          <p className="text-sm text-muted-foreground">No news published yet.</p>
        )}
      </section>

      <section aria-label="Latest release" className={dockCellClass}>
        <Link
          className={dockLinkClass}
          to="/changelog"
        >
          <FileText className="h-4 w-4 text-muted-foreground" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-foreground">{latestChangelog.version}</span>
            <span className="block truncate text-[11px] text-muted-foreground">{latestChangelog.date}</span>
          </span>
          <ArrowRight className="h-4 w-4 shrink-0 opacity-60 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
        </Link>
      </section>

      <section aria-label="Misty on social media" className={`${dockCellClass} justify-items-center justify-self-end max-[760px]:justify-self-stretch`}>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {socialLinks.map(({ href, icon: Icon, label }) => (
            <Button
              aria-label={label}
              className="size-8 text-muted-foreground"
              key={label}
              onClick={() => void openExternalLink(href)}
              title={label}
              size="icon"
              type="button"
              variant="ghost"
            >
              <Icon className="h-5 w-5" />
            </Button>
          ))}
        </div>
      </section>
    </footer>
  );
}
