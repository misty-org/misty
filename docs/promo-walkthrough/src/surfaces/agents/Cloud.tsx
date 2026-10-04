import lavender from "@/shared/assets/agents/cloud-lavender-poster.webp";
import mint from "@/shared/assets/agents/cloud-mint-poster.webp";
import peach from "@/shared/assets/agents/cloud-peach-poster.webp";
import sky from "@/shared/assets/agents/cloud-sky-poster.webp";

export const clouds = { sky, lavender, mint, peach };

/** Real agent cloud artwork, graded to grayscale for the monochrome film. */
export function Cloud({ src, size = 40 }: { src: string; size?: number }) {
  return <img src={src} alt="" className="shrink-0 grayscale" style={{ width: size, height: size }} />;
}
