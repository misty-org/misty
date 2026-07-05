import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { HiOutlineLockClosed, HiOutlinePuzzlePiece, HiOutlineSparkles } from "react-icons/hi2";
import { FiZap } from "react-icons/fi";

const PUBLIC_ASSET_BASE_URL =
  import.meta.env.VITE_PUBLIC_ASSET_BASE_URL || "https://public.mistysys.com";

const SCREENSHOT_LEAD_VIEWPORT_RATIO = 0.78;
const CALLOUT_ENTRY_PROGRESS = 0.18;
const CALLOUT_EXIT_PROGRESS = 0.72;
const CALLOUT_OFFSCREEN_TRANSLATE = 125;

const searchProviders = ["Google Drive", "OneDrive", "Dropbox"];
const filePool = [
  "photos.zip",
  "report.pdf",
  "backup/",
  "video.mp4",
  "archive.tar",
  "assets/",
  "notes.docx",
  "data.csv",
  "exports/",
];

type ShowcaseScene = {
  key: string;
  eyebrow: string;
  title: ReactNode;
  description: string;
  screenshotSrc: string;
  screenshotAlt: string;
  placeholder: string;
  accent: string;
  Icon: ComponentType<{ className?: string }>;
};

function SearchDiagram() {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
      {searchProviders.map((provider, index) => (
        <span
          key={provider}
          className={`rounded-lg border px-2.5 py-1.5 ${
            index === 0 ? "border-white/20 bg-elevated text-text" : "border-border bg-surface"
          }`}
        >
          {provider}
        </span>
      ))}
      <span className="text-text-muted">-&gt;</span>
      <span className="rounded-lg border border-white/20 bg-white px-2.5 py-1.5 font-medium text-black">
        One index
      </span>
    </div>
  );
}

function TransferTrack({
  initialProgress,
  initialIdx,
}: {
  initialProgress: number;
  initialIdx: number;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-28 truncate text-text-muted">{filePool[initialIdx]}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface">
        <div className="h-full rounded-full bg-text-muted" style={{ width: `${initialProgress}%` }} />
      </div>
    </div>
  );
}

function OAuthPacket() {
  return (
    <div className="flex items-center gap-2 text-xs text-text-muted">
      <div className="shrink-0 rounded-lg border border-border bg-surface px-3 py-2">
        <span className="font-medium text-text">Your device</span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col items-center gap-0.5">
        <span className="text-[10px]">Oauth</span>
        <div className="relative flex h-3 w-full items-center">
          <div className="absolute inset-x-0 border-t border-dashed border-border" />
          <div className="absolute left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-zinc-300" />
        </div>
      </div>
      <div className="shrink-0 rounded-lg border border-border bg-surface px-3 py-2">
        <span>Cloud provider</span>
      </div>
    </div>
  );
}

function ChatCycler() {
  return (
    <div className="flex h-[210px] flex-col gap-2 text-xs">
      <div className="max-w-[80%] self-end rounded-xl border border-border bg-elevated px-3 py-2 text-text">
        Which files changed since last week?
      </div>
      <div className="min-h-[52px] max-w-[80%] self-start">
        <div className="rounded-xl border border-border bg-surface px-3 py-2 text-text-muted">
          Found 4 modified files in <span className="font-mono text-text">~/projects/</span> since Apr 11...
        </div>
      </div>
      <div className="mt-auto max-w-[80%] self-end rounded-xl border border-border bg-elevated px-3 py-2 text-text">
        Perfect, that's what I needed!
      </div>
    </div>
  );
}

function ScreenshotFrame({
  scene,
  active,
  index,
}: {
  scene: ShowcaseScene;
  active: boolean;
  index: number;
}) {
  return (
    <div
      className={`relative h-full transition-all duration-700 ease-out ${
        active ? "opacity-100" : "opacity-70"
      }`}
      style={{
        transform: active
          ? `translate3d(0, 0, 0) rotateX(0deg) rotateY(${index % 2 === 0 ? "-2deg" : "2deg"}) scale(1)`
          : `translate3d(${index % 2 === 0 ? 24 : -24}px, 28px, -60px) rotateX(7deg) rotateY(${
              index % 2 === 0 ? -9 : 9
            }deg) scale(0.95)`,
      }}
    >
      <div className="relative h-full overflow-hidden rounded-xl border border-white/10 bg-[#121416] shadow-[0_30px_90px_rgba(0,0,0,0.42)]">
        <div className="flex h-9 items-center gap-1.5 border-b border-white/10 bg-[#191b1f] px-3">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#ffbd2e]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
          <span className="ml-3 truncate text-[11px] text-text-muted">{scene.eyebrow}</span>
        </div>

        {scene.screenshotSrc ? (
          <img
            src={scene.screenshotSrc}
            alt={scene.screenshotAlt}
            className="h-[calc(100%-2.25rem)] w-full object-cover object-top"
            draggable={false}
          />
        ) : (
          <div className="flex h-[calc(100%-2.25rem)] flex-col justify-between bg-[#0f1114] p-3 md:p-4">
            <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-2 md:grid-cols-[140px_minmax(0,1fr)] md:gap-4">
              <div className="space-y-2">
                <div className="h-5 rounded-md border border-white/10 bg-white/[0.06] md:h-8" />
                <div className="h-5 rounded-md border border-white/10 bg-white/[0.035] md:h-8" />
                <div className="h-5 rounded-md border border-white/10 bg-white/[0.035] md:h-8" />
                <div className="h-5 rounded-md border border-white/10 bg-white/[0.035] md:h-8" />
              </div>
              <div className="space-y-2 md:space-y-3">
                <div className="h-7 rounded-lg border border-white/10 bg-white/[0.06] md:h-10" />
                <div className="grid grid-cols-3 gap-2 md:gap-3">
                  <div className="h-12 rounded-lg border border-white/10 bg-white/[0.04] md:h-20" />
                  <div className="h-12 rounded-lg border border-white/10 bg-white/[0.04] md:h-20" />
                  <div className="h-12 rounded-lg border border-white/10 bg-white/[0.04] md:h-20" />
                </div>
                <div className="h-14 rounded-lg border border-dashed border-white/20 bg-white/[0.025] md:h-28" />
              </div>
            </div>
            <div>
              <p className="mb-1 text-[11px] uppercase tracking-[0.18em] text-text-muted/60">Screenshot slot</p>
              <p className="break-words text-xs text-text-muted md:text-sm">{scene.placeholder}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SceneDetail({ sceneKey }: { sceneKey: string }) {
  if (sceneKey === "fast") {
    return (
      <div className="divide-y divide-border/70 rounded-xl border border-border/60 bg-surface/10">
        <div className="px-4 py-4 md:px-5">
          <h3 className="mb-2 text-lg font-bold text-text">Unified search</h3>
          <p className="mb-4 text-sm text-text-muted">One query across everything you connect.</p>
          <SearchDiagram />
        </div>
        <div className="px-4 py-4 md:px-5">
          <h3 className="mb-2 text-lg font-bold text-text">Background transfers</h3>
          <p className="mb-4 text-sm text-text-muted">Transfers keep running while you keep working.</p>
          <div className="flex flex-col gap-2 text-xs">
            <TransferTrack initialProgress={34} initialIdx={0} />
            <TransferTrack initialProgress={68} initialIdx={1} />
            <TransferTrack initialProgress={18} initialIdx={2} />
          </div>
        </div>
      </div>
    );
  }

  if (sceneKey === "secure") {
    return (
      <div className="divide-y divide-border/70 rounded-xl border border-border/60 bg-surface/10">
        <div className="px-4 py-4 md:px-5">
          <a
            href="/docs/introduction"
            className="text-xs text-text-muted underline underline-offset-4 transition-colors hover:text-white"
          >
            Learn more about how Misty works
          </a>
        </div>
        <div className="px-4 py-4 md:px-5">
          <p className="mb-4 text-[11px] uppercase tracking-[0.18em] text-text-muted/70">Authentication flow</p>
          <OAuthPacket />
        </div>
      </div>
    );
  }

  if (sceneKey === "plugins") {
    return (
      <div className="rounded-xl border border-border/60 bg-surface/10 p-4 md:p-5">
        <p className="mb-4 text-sm text-text-muted">Install focused tools and panels that match the work in front of you.</p>
        <a
          href="/plugins"
          className="text-xs text-text-muted underline underline-offset-4 transition-colors hover:text-white"
        >
          Explore plugins
        </a>
      </div>
    );
  }

  return (
    <div className="divide-y divide-border/70 rounded-xl border border-border/60 bg-surface/10">
      <div className="px-4 py-4 md:px-5">
        <h3 className="mb-3 text-lg font-bold text-text">Ask your files anything.</h3>
        <p className="text-pretty text-text-muted">Search, summarize, and act without leaving the current view.</p>
      </div>
      <div className="px-4 py-4 md:px-5">
        <ChatCycler />
      </div>
      <div className="flex justify-end px-4 py-4 md:px-5">
        <a href="/docs" className="text-xs text-text-muted underline underline-offset-4 transition-colors hover:text-white">
          Learn more
        </a>
      </div>
    </div>
  );
}

function SceneTextCard({
  scene,
  compact = false,
}: {
  scene: ShowcaseScene;
  compact?: boolean;
}) {
  const Icon = scene.Icon;

  return (
    <div className="flex h-full w-full flex-col justify-center">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-surface">
          <Icon className="h-5 w-5 text-text-muted" />
        </div>
        <p className="text-[11px] uppercase tracking-[0.18em] text-text-muted/70">{scene.eyebrow}</p>
      </div>
      <h2 className="mb-4 text-2xl font-bold tracking-tight text-text md:text-[1.65rem]">{scene.title}</h2>
      <p className={compact ? "text-pretty text-sm leading-6 text-text-muted" : "mb-6 max-w-xl text-pretty text-text-muted"}>
        {scene.description}
      </p>
      {!compact && <SceneDetail sceneKey={scene.key} />}
    </div>
  );
}

function getCalloutPlacement(index: number) {
  const placements = [
    { horizontal: "left", vertical: "top" },
    { horizontal: "right", vertical: "bottom" },
    { horizontal: "right", vertical: "top" },
    { horizontal: "left", vertical: "bottom" },
  ] as const;

  return placements[index % placements.length];
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getCalloutTranslate(progress: number, isTop: boolean) {
  const direction = isTop ? -1 : 1;

  if (progress <= 0) {
    return direction * CALLOUT_OFFSCREEN_TRANSLATE;
  }

  if (progress < CALLOUT_ENTRY_PROGRESS) {
    const entryProgress = progress / CALLOUT_ENTRY_PROGRESS;
    return direction * (1 - entryProgress) * CALLOUT_OFFSCREEN_TRANSLATE;
  }

  if (progress > CALLOUT_EXIT_PROGRESS) {
    const exitProgress = (progress - CALLOUT_EXIT_PROGRESS) / (1 - CALLOUT_EXIT_PROGRESS);
    return direction * clamp(exitProgress, 0, 1) * CALLOUT_OFFSCREEN_TRANSLATE;
  }

  return 0;
}

export default function ProductScrollShowcase() {
  const sectionRef = useRef<HTMLElement | null>(null);
  const sceneRefs = useRef<Array<HTMLElement | null>>([]);
  const activeSceneRef = useRef(0);
  const [activeScene, setActiveScene] = useState(0);
  const [calloutTransforms, setCalloutTransforms] = useState<string[]>([]);
  const screenshotStageStyle = {
    width: "100%",
  };

  const scenes: ShowcaseScene[] = [
    {
      key: "fast",
      eyebrow: "Fast workflows",
      title: (
        <>
          <span className="text-white">Fast</span>, zero bloat.
        </>
      ),
      description: "Search, browse, and move files without the interface getting in your way.",
      screenshotSrc: "",
      screenshotAlt: "Misty fast workflow preview",
      placeholder: `Attach ${PUBLIC_ASSET_BASE_URL}/showcase/fast.png`,
      accent: "from-zinc-100/18",
      Icon: FiZap,
    },
    {
      key: "secure",
      eyebrow: "Secure connections",
      title: (
        <>
          <span className="text-white">Secure</span> by design.
        </>
      ),
      description: "Your accounts connect directly, and your file contents stay out of our hands.",
      screenshotSrc: "",
      screenshotAlt: "Misty secure authentication preview",
      placeholder: `Attach ${PUBLIC_ASSET_BASE_URL}/showcase/secure.png`,
      accent: "from-emerald-300/14",
      Icon: HiOutlineLockClosed,
    },
    {
      key: "plugins",
      eyebrow: "Extensible workspace",
      title: "Plugins, built in.",
      description: "Add tools and panels that fit the way you work.",
      screenshotSrc: "/misty-plugins.png",
      screenshotAlt: "Misty plugins browser screenshot",
      placeholder: `Attach ${PUBLIC_ASSET_BASE_URL}/showcase/plugins.png`,
      accent: "from-sky-300/14",
      Icon: HiOutlinePuzzlePiece,
    },
    {
      key: "smart",
      eyebrow: "Context aware AI",
      title: "Smart and context aware.",
      description: "Answers stay grounded in the files and workspace already in front of you.",
      screenshotSrc: "",
      screenshotAlt: "Misty AI workspace preview",
      placeholder: `Attach ${PUBLIC_ASSET_BASE_URL}/showcase/smart.png`,
      accent: "from-fuchsia-200/14",
      Icon: HiOutlineSparkles,
    },
  ];

  useEffect(() => {
    let frame = 0;

    const updateActiveScene = () => {
      frame = 0;
      const leadY = window.innerHeight * SCREENSHOT_LEAD_VIEWPORT_RATIO;
      let nextScene = 0;
      const nextTransforms: string[] = [];

      sceneRefs.current.forEach((scene, index) => {
        if (!scene) return;
        const rect = scene.getBoundingClientRect();
        const placement = getCalloutPlacement(index);
        const progress = clamp(
          (window.innerHeight - rect.top) / (window.innerHeight + rect.height),
          0,
          1,
        );
        const translateY = getCalloutTranslate(progress, placement.vertical === "top");

        nextTransforms[index] = `translateY(${translateY.toFixed(2)}%)`;

        if (rect.top <= leadY && rect.bottom > 0) {
          nextScene = index;
        }
      });

      if (nextScene !== activeSceneRef.current) {
        activeSceneRef.current = nextScene;
        setActiveScene(nextScene);
      }

      setCalloutTransforms((currentTransforms) => {
        const changed =
          currentTransforms.length !== nextTransforms.length ||
          nextTransforms.some((transform, index) => transform !== currentTransforms[index]);

        return changed ? nextTransforms : currentTransforms;
      });
    };

    const scheduleUpdate = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(updateActiveScene);
    };

    updateActiveScene();
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, []);

  return (
    <section
      ref={sectionRef}
      className="relative w-full overflow-x-clip"
      data-showcase-root
    >
      <div className="absolute inset-x-0 top-12 h-[640px] bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.075),transparent_68%)]" />
      <div className="relative md:grid md:grid-cols-1">
        <div className="relative z-0 hidden md:col-start-1 md:row-start-1 md:block">
          <div className="sticky top-24 flex h-[calc(100vh-7rem)] min-h-[540px] items-center justify-start">
            <div
              className="relative aspect-[16/9] w-full"
              style={{ ...screenshotStageStyle, perspective: "1400px" }}
            >
              <div className="relative h-full w-full">
                <div className="absolute inset-0 rounded-[28px] border border-white/10 bg-[#080a0c] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_34px_110px_rgba(0,0,0,0.5)]" />
                {scenes.map((scene, index) => (
                  <div
                    key={`${scene.key}-glow`}
                    className={`absolute inset-8 rounded-[26px] bg-gradient-to-br ${scene.accent} to-transparent blur-2xl transition-opacity duration-700 ${
                      activeScene === index ? "opacity-100" : "opacity-0"
                    }`}
                  />
                ))}
                <div className="absolute inset-4 md:inset-5" style={{ transformStyle: "preserve-3d" }}>
                  {scenes.map((scene, index) => (
                    <div
                      key={scene.key}
                      data-showcase-screenshot={index}
                      className={`absolute inset-0 transition-opacity duration-700 ${
                        activeScene === index ? "opacity-100" : "pointer-events-none opacity-0"
                      }`}
                    >
                      <ScreenshotFrame scene={scene} active={activeScene === index} index={index} />
                    </div>
                  ))}
                </div>
              </div>
              <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden rounded-[28px]">
                {scenes.map((scene, index) => {
                  const placement = getCalloutPlacement(index);
                  const isTop = placement.vertical === "top";
                  const isLeft = placement.horizontal === "left";
                  const isActive = activeScene === index;
                  const transform =
                    calloutTransforms[index] ??
                    (isTop
                      ? `translateY(-${CALLOUT_OFFSCREEN_TRANSLATE}%)`
                      : `translateY(${CALLOUT_OFFSCREEN_TRANSLATE}%)`);

                  return (
                    <div
                      key={`${scene.key}-callout`}
                      data-showcase-card={index}
                      aria-hidden={!isActive}
                      className={`glass-card absolute flex rounded-2xl border-white/16 bg-[#0d1013]/95 p-5 shadow-[0_22px_64px_rgba(0,0,0,0.34)] backdrop-blur-xl ${
                        isTop ? "top-4" : "bottom-4"
                      } ${isLeft ? "left-4" : "right-4"}`}
                      style={{
                        transform,
                        transition: "transform 120ms linear",
                        width: "min(310px, calc(50% - 1.25rem))",
                        willChange: "transform",
                      }}
                    >
                      <SceneTextCard scene={scene} compact />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="relative z-10 mx-auto flex w-full flex-col gap-8 md:col-start-1 md:row-start-1 md:gap-0 md:pb-[45vh]">
          {scenes.map((scene, index) => {
            return (
              <article
                key={scene.key}
                ref={(node) => {
                  sceneRefs.current[index] = node;
                }}
                className="relative grid scroll-mt-24 gap-5 md:block md:min-h-[calc(115vh-7rem)]"
              >
                <div className="glass-card flex rounded-2xl border-white/16 bg-[#0d1013]/95 p-5 shadow-[0_22px_64px_rgba(0,0,0,0.34)] backdrop-blur-xl md:hidden">
                  <SceneTextCard scene={scene} />
                </div>

                <div className="relative aspect-[16/10] w-full md:hidden" style={{ perspective: "1200px" }}>
                  <div className="absolute inset-0 rounded-[28px] border border-white/10 bg-[#080a0c] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_28px_90px_rgba(0,0,0,0.45)]" />
                  <div
                    className={`absolute inset-8 rounded-[26px] bg-gradient-to-br ${scene.accent} to-transparent blur-2xl transition-opacity duration-700 ${
                      activeScene === index ? "opacity-100" : "opacity-35"
                    }`}
                  />
                  <div className="absolute inset-5" style={{ transformStyle: "preserve-3d" }}>
                    <ScreenshotFrame scene={scene} active={activeScene === index} index={index} />
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
