import { useEffect, useRef, useState } from "react";
import { Video } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { NavLink } from "react-router";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { featureChapters, type FeatureChapter } from "../Features/featureData";

type ShowcaseMedia =
  | {
      kind: "placeholder";
      label: string;
    }
  | {
      kind: "image";
      src: string;
      alt: string;
    }
  | {
      kind: "video";
      src: string;
      poster?: string;
      label: string;
    };

type ShowcaseStage = Pick<FeatureChapter, "id" | "title" | "description"> & {
  media: ShowcaseMedia;
};

type ProductShowcaseProps = {
  stages?: ShowcaseStage[];
};

const defaultStages: ShowcaseStage[] = featureChapters.map((chapter) => ({
  id: chapter.id,
  title: chapter.title,
  description: chapter.description,
  media: {
    kind: "placeholder",
    label: chapter.title,
  },
}));

function MediaPlaceholder({ label }: { label: string }) {
  return (
    <div
      className="flex h-full w-full flex-col items-center justify-center gap-4 bg-muted/35 px-6 text-center"
      role="img"
      aria-label={`${label} demo placeholder`}
      data-showcase-placeholder={label.toLowerCase()}
    >
      <span className="flex size-12 items-center justify-center rounded-lg border border-border bg-background shadow-sm">
        <Video className="size-5 text-muted-foreground" aria-hidden="true" />
      </span>
      <div>
        <p className="font-medium text-foreground">{label} demo</p>
        <p className="mt-1 text-sm text-muted-foreground">Coming soon</p>
      </div>
    </div>
  );
}

function ShowcaseMediaFrame({
  active,
  media,
  stageTitle,
}: {
  active: boolean;
  media: ShowcaseMedia;
  stageTitle: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [mediaFailed, setMediaFailed] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || media.kind !== "video") {
      return;
    }

    if (active) {
      void video.play().catch(() => {
        // Muted autoplay can still be declined by user or browser preferences.
      });
    } else {
      video.pause();
    }

    return () => video.pause();
  }, [active, media]);

  let content;

  if (mediaFailed && media.kind === "video" && media.poster && !posterFailed) {
    content = (
      <img
        src={media.poster}
        alt={`${media.label} demo preview`}
        className="h-full w-full object-cover"
        loading="lazy"
        decoding="async"
        onError={() => setPosterFailed(true)}
      />
    );
  } else if (mediaFailed || media.kind === "placeholder") {
    content = <MediaPlaceholder label={stageTitle} />;
  } else if (media.kind === "image") {
    content = (
      <img
        src={media.src}
        alt={media.alt}
        className="h-full w-full object-cover"
        loading="lazy"
        decoding="async"
        onError={() => setMediaFailed(true)}
      />
    );
  } else {
    content = (
      <video
        ref={videoRef}
        src={media.src}
        poster={media.poster}
        aria-label={`${media.label} demo video`}
        className="h-full w-full object-cover"
        autoPlay
        loop
        muted
        playsInline
        preload="metadata"
        onError={() => setMediaFailed(true)}
      />
    );
  }

  return (
    <div
      className="aspect-[16/10] w-full overflow-hidden rounded-xl border border-border bg-card shadow-sm"
      data-showcase-media={media.kind}
    >
      {content}
    </div>
  );
}

export default function ProductShowcase({ stages = defaultStages }: ProductShowcaseProps) {
  const reducedMotion = Boolean(useReducedMotion());
  const [activeStageId, setActiveStageId] = useState(stages[0]?.id ?? "files");
  const activeStage = stages.find((stage) => stage.id === activeStageId) ?? stages[0];

  if (!activeStage) {
    return null;
  }

  const panelMotion = reducedMotion
    ? { initial: false as const, animate: { opacity: 1, y: 0 }, exit: { opacity: 1, y: 0 } }
    : {
        initial: { opacity: 0, y: 8 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: -8 },
      };

  return (
    <section
      className="w-full py-8 text-center md:py-12"
      data-showcase-root
      data-motion={reducedMotion ? "reduced" : "full"}
    >
      <div className="mx-auto max-w-3xl">
        <p className="mb-4 text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          How Misty works
        </p>
        <h2 className="text-4xl font-bold tracking-tight text-foreground md:text-6xl">
          Files <span className="text-muted-foreground/40">&rarr;</span> Space{" "}
          <span className="text-muted-foreground/40">&rarr;</span> Intelligence
        </h2>
        <p className="mx-auto mt-5 max-w-2xl text-pretty text-base leading-7 text-muted-foreground md:text-lg md:leading-8">
          Files become shared context in a Space. Intelligence turns that context into assistance,
          workflows, and agents.
        </p>
      </div>

      <Tabs
        value={activeStage.id}
        onValueChange={(value) => setActiveStageId(value as ShowcaseStage["id"])}
        className="mt-9 w-full gap-6 md:mt-12"
        activationMode="automatic"
      >
        <TabsList
          className="mx-auto grid h-11 w-full max-w-md grid-cols-3"
          aria-label="Misty product stages"
        >
          {stages.map((stage) => (
            <TabsTrigger key={stage.id} value={stage.id} className="px-3">
              {stage.title}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value={activeStage.id} className="mt-0">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={activeStage.id}
              {...panelMotion}
              transition={{ duration: reducedMotion ? 0 : 0.18, ease: "easeOut" }}
              className="mx-auto max-w-6xl"
              data-showcase-panel={activeStage.id}
            >
              <p className="mx-auto mb-6 max-w-2xl text-base leading-7 text-muted-foreground md:text-lg">
                {activeStage.description}
              </p>
              <ShowcaseMediaFrame
                key={activeStage.id}
                active
                media={activeStage.media}
                stageTitle={activeStage.title}
              />
            </motion.div>
          </AnimatePresence>
        </TabsContent>
      </Tabs>

      <Button asChild className="mt-8 rounded-full px-5 shadow-sm">
        <NavLink to="/features">More features</NavLink>
      </Button>
    </section>
  );
}
