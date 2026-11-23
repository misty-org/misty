import type { SVGProps } from "react";
import paths from "./socialMarks.json";

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
