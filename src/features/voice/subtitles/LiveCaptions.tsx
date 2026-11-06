import { useLayoutEffect, useRef, useState } from "react";

// From Audeeo (MIT, Matthew Chen): the words shown always end at the newest one.
const FONT_SIZE = 24;

/** Layout-only pagination: retain a measured suffix, independently of provider items. */
export function captionSuffix(text: string, fits: (text: string) => boolean) {
  const chars = Array.from(text.replace(/\s+/gu, " "));
  // Only measure the recent tail. Measuring half of an ever-growing transcript
  // forces increasingly expensive synchronous layouts on every streamed token.
  let high = chars.length;
  let low = Math.max(0, high - 128);
  while (low > 0 && fits(chars.slice(low).join(""))) {
    high = low;
    low = Math.max(0, chars.length - (chars.length - low) * 2);
  }
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (fits(chars.slice(mid).join(""))) high = mid;
    else low = mid + 1;
  }
  const space = chars.indexOf(" ", low);
  if (low > 0 && space >= low && space - low < 18) low = space + 1;
  return chars.slice(low).join("").trim();
}

function CaptionLine(props: {
  text: string;
  lines: number;
  size: number;
  lang: string;
  kind: "source" | "translation";
}) {
  const { text, lines, size, lang, kind } = props;
  const ref = useRef<HTMLParagraphElement>(null);
  const [visible, setVisible] = useState("");
  useLayoutEffect(() => {
    const element = ref.current!;
    const update = () => {
      const probe = element.cloneNode(false) as HTMLParagraphElement;
      Object.assign(probe.style, {
        position: "fixed",
        left: "0",
        top: "0",
        contain: "strict",
        visibility: "hidden",
        width: `${element.clientWidth}px`,
        pointerEvents: "none",
      });
      element.parentElement!.appendChild(probe);
      const suffix = captionSuffix(text, (candidate) => {
        probe.textContent = candidate;
        return probe.scrollHeight <= probe.clientHeight + 1;
      });
      probe.remove();
      setVisible(suffix);
    };
    update();
    let disposed = false;
    if (document.fonts?.status === "loading")
      void document.fonts.ready.then(() => {
        if (!disposed) update();
      });
    let previousWidth = element.clientWidth;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth === previousWidth) return;
      previousWidth = element.clientWidth;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!disposed) update();
      });
    });
    observer.observe(element);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [text, lines, size]);
  return (
    <p
      ref={ref}
      lang={lang === "auto" ? undefined : lang}
      dir="auto"
      className={`subtitle-line subtitle-line-${kind}`}
      style={{ fontSize: size, height: `${lines * 1.35}em` }}
    >
      {visible}
    </p>
  );
}

/** What was said and its translation: one line each when there are both, as in Audeeo. */
export function LiveCaptions(props: {
  source: string;
  translation: string;
  sourceLanguage: string;
  targetLanguage: string;
}) {
  const { source, translation, sourceLanguage, targetLanguage } = props;
  const both = !!source && !!translation;
  return (
    <section className="subtitle-captions" aria-label="Live subtitles" aria-live="polite">
      {source && (
        <CaptionLine
          kind="source"
          text={source}
          lines={both ? 1 : 2}
          size={both ? FONT_SIZE * 0.8 : FONT_SIZE}
          lang={sourceLanguage}
        />
      )}
      {translation && (
        <CaptionLine
          kind="translation"
          text={translation}
          lines={both ? 1 : 2}
          size={FONT_SIZE}
          lang={targetLanguage}
        />
      )}
    </section>
  );
}
