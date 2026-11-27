import { LetterTile, LogoTile, Mark, markFor } from "@misty/ui";

const githubLogin = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

export function githubOwner(link: string | null | undefined) {
  const match = /^https:\/\/github\.com\/([^/?#]+)/.exec(link ?? "");
  return match && githubLogin.test(match[1]) ? match[1] : undefined;
}

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

function brandOf(name: string) {
  const plain = name.trim().toLowerCase();
  const candidates = [
    plain,
    `${plain}-logo`,
    plain.replace(/s$/, ""),
    plain.replace(/,?\s*(?:inc|llc|ltd)\.?$/, "").replace(/[^a-z0-9]+/g, ""),
  ];
  return candidates.find((candidate) => candidate && markFor(candidate));
}

export interface PluginMaker {
  name?: string;
  brand?: string;
}

export function pluginMaker(item: { author?: string | null; link: string | null }): PluginMaker {
  const author = item.author?.trim() || undefined;
  const owner = githubOwner(item.link);
  const brand = (author && brandOf(author)) || (owner && brandOf(owner)) || undefined;
  return brand ? { name: author ?? owner, brand } : { name: author ?? owner };
}

export function MakerTile({
  maker,
  name,
  size = "item",
}: {
  maker: PluginMaker;
  name: string;
  size?: "item" | "sheet";
}) {
  if (maker.brand) {
    return (
      <LogoTile size={size}>
        <Mark of={maker.brand} label={maker.name ?? name} size={size === "sheet" ? 63 : 36} />
      </LogoTile>
    );
  }
  return (
    <LogoTile size={size}>
      <LetterTile name={name} size={size === "sheet" ? "hero" : "tile"} />
    </LogoTile>
  );
}
