import type { SVGProps } from "react";
import paths from "./socialMarks.json";

/** Monochrome brand marks for the signed-out bar, from Simple Icons (CC0). Lucide has no brands, and
 * `BrandIcon` keeps each logo's own colors. */
function mark(d: string) {
  return function SocialIcon(props: SVGProps<SVGSVGElement>) {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
        <path d={d} />
      </svg>
    );
  };
}

export const GithubMark = mark(paths.GithubMark);
export const XMark = mark(paths.XMark);
export const DiscordMark = mark(paths.DiscordMark);
export const YoutubeMark = mark(paths.YoutubeMark);
export const InstagramMark = mark(paths.InstagramMark);
