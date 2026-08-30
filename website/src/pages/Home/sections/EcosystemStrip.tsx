import { useEffect, useRef, useState, type CSSProperties } from "react";

type BrandItem = {
  name: string;
  src: string;
  href: string;
  invertOnDark?: boolean;
};

const outlookLogo = new URL(
  "../../../../../app/src/shared/assets/mail-providers/outlook-fy26.svg",
  import.meta.url,
).href;

const openSourceTools: BrandItem[] = [
  {
    name: "Tauri",
    src: "https://api.iconify.design/logos:tauri.svg",
    href: "https://tauri.app/",
  },
  {
    name: "Excalidraw",
    src: "https://cdn.simpleicons.org/excalidraw/6965DB",
    href: "https://excalidraw.com/",
  },
  {
    name: "Activepieces",
    src: "https://www.activepieces.com/logo.svg",
    href: "https://www.activepieces.com/",
  },
  {
    name: "CodeMirror",
    src: "https://codemirror.net/style/logo.svg",
    href: "https://codemirror.net/",
  },
  {
    name: "xterm.js",
    src: "https://raw.githubusercontent.com/xtermjs/xtermjs-branding/master/logo.svg",
    href: "https://xtermjs.org/",
  },
  {
    name: "PDF.js",
    src: "https://raw.githubusercontent.com/mozilla/pdf.js/master/src/images/logo.svg",
    href: "https://mozilla.github.io/pdf.js/",
  },
  {
    name: "Yjs",
    src: "https://yjs.dev/icon.svg?7cc1f16238e73231",
    href: "https://yjs.dev/",
  },
  {
    name: "React Flow",
    src: "https://reactflow.dev/icon.svg?icon.09l0-uedd1wof.svg",
    href: "https://reactflow.dev/",
  },
];

const integrations: BrandItem[] = [
  {
    name: "Gmail",
    src: "https://upload.wikimedia.org/wikipedia/commons/8/8f/Gmail_icon_%282026%29.svg",
    href: "https://workspace.google.com/products/gmail/",
  },
  {
    name: "Outlook",
    src: outlookLogo,
    href: "https://www.microsoft.com/microsoft-365/outlook/email-and-calendar-software-microsoft-outlook",
  },
  {
    name: "Instagram",
    src: "https://upload.wikimedia.org/wikipedia/commons/2/21/Instagram_Glyph_Gradient_RGB_logo.svg",
    href: "https://www.instagram.com/",
  },
  {
    name: "Messenger",
    src: "https://api.iconify.design/logos:messenger.svg",
    href: "https://www.messenger.com/",
  },
  {
    name: "X",
    src: "https://api.iconify.design/logos:x.svg",
    href: "https://x.com/",
    invertOnDark: true,
  },
  {
    name: "Discord",
    src: "https://api.iconify.design/logos:discord-icon.svg",
    href: "https://discord.com/",
  },
  {
    name: "Google Drive",
    src: "https://api.iconify.design/logos:google-drive.svg",
    href: "https://workspace.google.com/products/drive/",
  },
  {
    name: "Dropbox",
    src: "https://api.iconify.design/logos:dropbox.svg",
    href: "https://www.dropbox.com/",
  },
  {
    name: "OneDrive",
    src: "https://api.iconify.design/logos:microsoft-onedrive.svg",
    href: "https://www.microsoft.com/microsoft-365/onedrive/online-cloud-storage",
  },
  {
    name: "Google Calendar",
    src: "https://api.iconify.design/logos:google-calendar.svg",
    href: "https://workspace.google.com/products/calendar/",
  },
  {
    name: "Google Sheets",
    src: "https://cdn.simpleicons.org/googlesheets/34A853",
    href: "https://workspace.google.com/products/sheets/",
  },
  {
    name: "Slack",
    src: "https://api.iconify.design/logos:slack-icon.svg",
    href: "https://slack.com/",
  },
  {
    name: "Notion",
    src: "https://api.iconify.design/logos:notion-icon.svg",
    href: "https://www.notion.com/",
    invertOnDark: true,
  },
  {
    name: "GitHub",
    src: "https://api.iconify.design/logos:github-icon.svg",
    href: "https://github.com/",
    invertOnDark: true,
  },
  {
    name: "Figma",
    src: "https://api.iconify.design/logos:figma.svg",
    href: "https://www.figma.com/",
  },
];

function BrandList({
  items,
  hidden = false,
  repetitions = 2,
}: {
  items: BrandItem[];
  hidden?: boolean;
  repetitions?: number;
}) {
  return (
    <ul className="brand-marquee-list" aria-hidden={hidden || undefined}>
      {Array.from({ length: repetitions }, (_, repetitionIndex) =>
        items.map(({ name, src, href, invertOnDark }) => (
          <li
            key={`${name}-${repetitionIndex}`}
            className="brand-marquee-item"
            aria-hidden={hidden || repetitionIndex > 0 || undefined}
          >
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              tabIndex={hidden || repetitionIndex > 0 ? -1 : 0}
              className="brand-marquee-link"
            >
              <img
                src={src}
                alt=""
                className={`brand-marquee-logo${invertOnDark ? " brand-marquee-logo-invert-dark" : ""}`}
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
              />
              <span>{name}</span>
            </a>
          </li>
        )),
      )}
    </ul>
  );
}

function BrandMarquee({
  items,
  reverse = false,
  duration,
}: {
  items: BrandItem[];
  reverse?: boolean;
  duration: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const observer = new IntersectionObserver(
      ([entry]) => setIsVisible(entry.isIntersecting),
      { threshold: 0.05 },
    );

    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="brand-marquee-panel">
      <div
        ref={rootRef}
        className={`brand-marquee${reverse ? " brand-marquee-reverse" : ""}${isVisible ? "" : " brand-marquee-paused"}`}
        style={{ "--brand-marquee-duration": duration } as CSSProperties}
      >
        <div className="brand-marquee-track">
          <BrandList items={items} />
          <BrandList items={items} hidden />
        </div>
      </div>
    </div>
  );
}

export function EcosystemStrip() {
  return (
    <section
      aria-label="Misty ecosystem"
      className="relative z-10 overflow-x-clip bg-background pb-6 pt-8 sm:pb-8 sm:pt-10 lg:-mt-[6svh] lg:pt-14"
    >
      <div className="site-container min-w-0">
        <div>
          <h2 className="text-center text-base font-semibold text-[var(--marketing-foreground)] sm:text-lg">
            Built with trusted open source software
          </h2>
          <BrandMarquee items={openSourceTools} duration="90s" />
        </div>

        <div className="mt-8 sm:mt-10">
          <h2 className="text-center text-base font-semibold text-[var(--marketing-foreground)] sm:text-lg">
            Connect with popular platforms
          </h2>
          <BrandMarquee items={integrations} reverse duration="120s" />
        </div>
      </div>
    </section>
  );
}
