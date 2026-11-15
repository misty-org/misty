import { brandIconAsset, LogoTile } from "@/shared/ui";
import { DirectAppLogo } from "../connected-apps/DirectAppLogo";

/** A GitHub user or organization's name, as GitHub allows it. */
const githubLogin = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

/** The owner in a github.com link: `obra` in `https://github.com/obra/superpowers`. */
export function githubOwner(link: string | null | undefined) {
  const match = /^https:\/\/github\.com\/([^/?#]+)/.exec(link ?? "");
  return match && githubLogin.test(match[1]) ? match[1] : undefined;
}

/**
 * The short line a card shows for where a plugin comes from: `owner/repo` on GitHub, with the
 * plugin's own folder when it lives inside its marketplace's repository
 * (`claude-plugins-official/code-review`); the host and path anywhere else.
 */
export function sourceLabel(link: string) {
  try {
    const url = new URL(link);
    const parts = url.pathname.split("/").filter(Boolean);
    if (url.hostname === "github.com" && parts.length >= 2) {
      const [owner, repo, kind, , ...folder] = parts;
      const repoName = repo.replace(/\.git$/, "");
      return kind === "tree" && folder.length
        ? `${repoName}/${folder[folder.length - 1]}`
        : `${owner}/${repoName}`;
    }
    return `${url.hostname}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    return link;
  }
}

/** Misty's own artwork for a maker, by the names it goes by: `Anthropic`, `anthropics`, `Microsoft`. */
function brandOf(name: string) {
  const plain = name.trim().toLowerCase();
  const candidates = [
    plain,
    `${plain}-logo`,
    plain.replace(/s$/, ""),
    plain.replace(/,?\s*(?:inc|llc|ltd)\.?$/, "").replace(/[^a-z0-9]+/g, ""),
  ];
  return candidates.find((candidate) => candidate && brandIconAsset(candidate));
}

export interface PluginMaker {
  /** Who made it, as the catalog names them, else its GitHub owner. */
  name?: string;
  /** Misty's own artwork for the maker, when it has some. */
  brand?: string;
  /** Otherwise, the maker's GitHub picture. */
  avatar?: string;
}

/**
 * Who made a plugin and the logo to show for them: Misty's own brand artwork for the maker (by
 * the name its catalog gives, then its repository's owner), else the owner's GitHub picture.
 */
export function pluginMaker(item: { author?: string | null; link: string | null }): PluginMaker {
  const author = item.author?.trim() || undefined;
  const owner = githubOwner(item.link);
  const brand = (author && brandOf(author)) || (owner && brandOf(owner)) || undefined;
  if (brand) return { name: author ?? owner, brand };
  // A maker named like a GitHub login is that login; otherwise the repository's owner.
  const login = author && githubLogin.test(author) ? author : owner;
  return {
    name: author ?? owner,
    avatar: login ? `https://github.com/${login}.png?size=80` : undefined,
  };
}

/** A plugin's or skill's logo: its maker's artwork standing bare, or their GitHub picture. */
export function MakerLogo({
  maker,
  name,
  size = "md",
}: {
  maker: PluginMaker;
  /** What it's called, for the initial shown when there's no logo. */
  name: string;
  size?: "sm" | "md";
}) {
  const pixels = size === "md" ? 24 : 18;
  return (
    <LogoTile size={size} cover={!maker.brand && Boolean(maker.avatar)}>
      <DirectAppLogo
        app={maker.brand ?? `github:${maker.name ?? name}`}
        name={maker.name ?? name}
        icon={maker.avatar}
        size={pixels}
      />
    </LogoTile>
  );
}
