import {
  MistyAppMockup,
  type MockupView,
} from "@/components/marketing/appchrome";
import { beatPosition, useScrollProgress } from "@/hooks/useScrollProgress";
import { cn } from "@/lib/utils";

type Beat = {
  title: string;
  description: string;
  view: MockupView;
};

const beats: Beat[] = [
  {
    title: "Create a Space",
    description:
      "A Space is one shared home for a group. The people, conversations, tasks, and files a project runs on live inside it instead of across a dozen tabs.",
    view: "space",
  },
  {
    title: "Your files stay private",
    description:
      "Browse what's on your device and in your connected drives without any of it leaving. You choose, file by file, what the group gets to see.",
    view: "files",
  },
  {
    title: "Pool what the group needs",
    description:
      "The Library holds the material the work depends on. It's built by the people in the Space, not synced wholesale off someone's disk.",
    view: "library",
  },
  {
    title: "Put Agents on it",
    description:
      "Custom Agents answer from the Space's permitted context and nothing else. Your private files are never in the window.",
    view: "agent",
  },
];

/* Beats stack in a single grid cell so the container sizes to the tallest one
   and nothing gets clipped when copy lengths differ. */
const STACKED = "[grid-area:1/1]";

function BeatCopy({ beat, index }: { beat: Beat; index: number }) {
  return (
    <>
      <p className="text-[11px] font-medium tracking-[0.08em] text-[var(--marketing-muted)]">
        {String(index + 1).padStart(2, "0")}
      </p>
      <h3 className="mt-4 text-[clamp(1.5rem,2.6vw,2.25rem)] font-medium leading-[1.15] tracking-[-0.03em] text-[var(--marketing-foreground)]">
        {beat.title}
      </h3>
      <p className="mt-5 max-w-md text-base leading-relaxed text-[var(--marketing-muted)]">
        {beat.description}
      </p>
    </>
  );
}

/**
 * A scroll-pinned walk through the product.
 *
 * The window pins to the viewport while roughly one screen of scroll is spent
 * on each beat, so scrolling drives a demo rather than paging past cards.
 *
 * The pinned track is desktop-only, and `prefers-reduced-motion` swaps it for
 * the stacked list (see `.pin-track` / `.pin-stacked` in index.css). Every
 * beat is therefore reachable without animating anything — no content lives
 * only inside the animation.
 */
export function HowItWorks() {
  const { ref, progress } = useScrollProgress<HTMLDivElement>();
  const { index: active, within } = beatPosition(progress, beats.length);

  // Segments behind the active beat read full; the active one fills with
  // scroll, so the bar tracks position continuously instead of stepping.
  const fill = (index: number) =>
    index < active ? 1 : index === active ? within : 0;

  return (
    <section
      aria-label="How Misty works"
      className="marketing-dark my-3 overflow-clip rounded-xl sm:my-4"
    >
      <div className="mx-auto max-w-[1440px] px-5 pt-16 sm:px-8 sm:pt-24 lg:px-12">
        <h2 className="max-w-2xl text-[clamp(1.75rem,3.4vw,2.75rem)] font-medium leading-[1.1] tracking-[-0.03em] text-[var(--marketing-foreground)]">
          Everything the work touches, in one place.
        </h2>
        <p className="mt-5 max-w-xl text-base leading-relaxed text-[var(--marketing-muted)] sm:text-lg">
          One Space holds the group's work. Your device holds everything else.
        </p>
      </div>

      {/* Track height sets the pace: one viewport of scroll per beat, plus one
          more to hold the last beat before the section releases. */}
      <div
        ref={ref}
        className="pin-track relative hidden lg:block"
        style={{ height: `${(beats.length + 1) * 100}svh` }}
      >
        <div className="pin-stage">
          <div className="mx-auto grid w-full max-w-[1440px] grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] items-center gap-12 px-5 sm:px-8 lg:px-12">
            <div>
              <div className="grid">
                {beats.map((beat, index) => (
                  <div
                    key={beat.title}
                    aria-hidden={index !== active}
                    className={cn(
                      "pin-beat",
                      STACKED,
                      index === active
                        ? "translate-y-0 opacity-100 blur-0"
                        : cn(
                            "pointer-events-none opacity-0 blur-[2px]",
                            index < active ? "-translate-y-4" : "translate-y-4",
                          ),
                    )}
                  >
                    <BeatCopy beat={beat} index={index} />
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="grid">
                {beats.map((beat, index) => (
                  <div
                    key={beat.title}
                    className={cn(
                      "pin-beat",
                      STACKED,
                      index === active
                        ? "scale-100 opacity-100"
                        : "pointer-events-none scale-[0.98] opacity-0",
                    )}
                  >
                    <MistyAppMockup
                      view={beat.view}
                      bodyClass="h-[400px]"
                      shadow={false}
                      className="ring-1 ring-white/[0.07]"
                    />
                  </div>
                ))}
              </div>

              {/* The indicator sits under the window rather than under the
                  copy: it reports where the demo is, so it belongs with the
                  demo. No transition — it is driven straight off scroll. */}
              <div className="mt-8 flex gap-2.5">
                {beats.map((beat, index) => (
                  <span
                    key={beat.title}
                    className="h-[3px] flex-1 overflow-hidden rounded-full bg-[var(--marketing-border-strong)]"
                  >
                    <span
                      className="block h-full rounded-full bg-[var(--marketing-foreground)]"
                      style={{ width: `${fill(index) * 100}%` }}
                    />
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Small screens — and reduced motion at any width — get the same beats
          as an ordinary stacked list. */}
      <div className="pin-stacked space-y-14 px-5 py-16 sm:px-8 lg:hidden">
        {beats.map((beat, index) => (
          <div key={beat.title}>
            <BeatCopy beat={beat} index={index} />
            <div className="mt-7">
              <MistyAppMockup
                view={beat.view}
                bodyClass="h-[320px]"
                shadow={false}
                className="ring-1 ring-white/[0.07]"
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
