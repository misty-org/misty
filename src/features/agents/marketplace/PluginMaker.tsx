import { AppLogoImage, LogoTile, Mark, markFor } from "@misty/ui";

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
  avatar?: string;
}

export function pluginMaker(item: { author?: string | null; link: string | null }): PluginMaker {
  const author = item.author?.trim() || undefined;
  const owner = githubOwner(item.link);
  const brand = (author && brandOf(author)) || (owner && brandOf(owner)) || undefined;
  if (brand) return { name: author ?? owner, brand };
  const login = author && githubLogin.test(author) ? author : owner;
  return {
    name: author ?? owner,
    avatar: login ? `https://github.com/${login}.png?size=160` : undefined,
  };
}

export function MakerTile({ maker, name }: { maker: PluginMaker; name: string }) {
  if (maker.brand) {
    return (
      <LogoTile size="tile">
        <Mark of={maker.brand} label={maker.name ?? name} size={40} />
      </LogoTile>
    );
  }
  return (
    <LogoTile size="tile" cover={Boolean(maker.avatar)}>
      <AppLogoImage src={maker.avatar} name={maker.name ?? name} size="tile" />
    </LogoTile>
  );
}
