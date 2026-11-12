import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  Maximize2,
  Pause,
  Play,
  RotateCcw,
  Trash2,
  Video,
} from "lucide-react";
import { confirmAction } from "@/shared/lib/confirmAction";
import { Button, IconButton, Pressable, useNotice, OverflowFadeText } from "@/shared/ui";
import { deleteVideoAudio, makeVideoAudio, sceneAudioBytes } from "../tutorAudio";
import { deleteVideoClips, makeVideoClips, sceneClipUrl } from "../tutorClips";
import { useTutorStore } from "../tutorStore";
import type { Guide } from "../tutorTypes";
import { recordVideo, saveBytes, sceneSeconds, svgUrl } from "./videoExport";

function clock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** A scene's filmed clip, as a playable address while it is shown. */
function useClip(guideId: string, index: number, filmed: boolean): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    setUrl(undefined);
    if (!filmed) return;
    let live = true;
    let made: string | undefined;
    sceneClipUrl(guideId, index)
      .then((address) => {
        made = address;
        if (live) setUrl(address);
        else URL.revokeObjectURL(address);
      })
      .catch(() => undefined);
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [guideId, index, filmed]);
  return url;
}

/**
 * A video overview, after NotebookLM's: each scene filmed on this computer's video model (or the
 * engine's drawing without one), its narration spoken on this computer's speech key, with
 * captions. It plays here, fills the screen, and saves as a video file.
 */
export function VideoView({ video, onClose }: { video: Guide; onClose(): void }) {
  const scenes = video.scenes ?? [];
  const [at, setAt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState("");
  const shownError =
    error ||
    (video.audio?.state === "failed" ? (video.audio.error ?? "") : "") ||
    (video.clips?.state === "failed" ? (video.clips.error ?? "") : "");
  useNotice(Boolean(shownError), {
    message: shownError,
    tone: "error",
    onDismiss: () => setError(""),
  });
  const [saving, setSaving] = useState<{ done: number; total: number }>();
  const audio = useRef<HTMLAudioElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const voiced = video.audio?.state === "ready";
  const scene = scenes[at];
  const clip = useClip(video.id, at, Boolean(scene?.clip));
  const filming = video.clips?.state === "making";
  const filmingScene = Math.min(scenes.length, scenes.filter((item) => item.clip).length + 1);
  const unfilmed = scenes.some((item) => !item.clip);

  // Each scene plays its own narration; without one it holds for reading time.
  useEffect(() => {
    const player = audio.current;
    if (!playing || !scene || !player) return;
    let url: string | undefined;
    let timer: number | undefined;
    let live = true;
    const next = () => {
      if (!live) return;
      if (at < scenes.length - 1) setAt(at + 1);
      else setPlaying(false);
    };
    if (voiced)
      sceneAudioBytes(video.id, at)
        .then((bytes) => {
          if (!live) return;
          url = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
          player.src = url;
          player.onended = () => (timer = window.setTimeout(next, 500));
          return player.play();
        })
        .catch(() => (timer = window.setTimeout(next, sceneSeconds(scene) * 1000)));
    else timer = window.setTimeout(next, sceneSeconds(scene) * 1000);
    return () => {
      live = false;
      player.pause();
      if (timer) window.clearTimeout(timer);
      if (url) URL.revokeObjectURL(url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, at, voiced, video.id]);

  const remove = async () => {
    if (!(await confirmAction(`Delete “${video.title}”? This can’t be undone.`))) return;
    void deleteVideoAudio(video);
    void deleteVideoClips(video);
    useTutorStore.getState().removeGuide(video.id);
    onClose();
  };
  const save = async () => {
    setPlaying(false);
    setSaving({ done: 0, total: 1 });
    try {
      const { blob, extension } = await recordVideo(video, (done, total) =>
        setSaving({ done, total }),
      );
      setSaving(undefined);
      await saveBytes(blob, video.title, extension, "Video");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(undefined);
    }
  };
  const total = scenes.reduce((sum, item) => sum + sceneSeconds(item), 0);

  return (
    <>
      <div className="tutor-lead">
        <IconButton label="Back to Create" onClick={onClose}>
          <ArrowLeft />
        </IconButton>
        <OverflowFadeText className="tutor-card-title">{video.title}</OverflowFadeText>
        <span className="tutor-actions">
          {video.audio?.state === "failed" ? (
            <Button variant="quiet" onClick={() => void makeVideoAudio(video.id)} icon={RotateCcw}>
              Make narration
            </Button>
          ) : null}
          {unfilmed && !filming && video.audio?.state !== "making" ? (
            <Button variant="quiet" onClick={() => void makeVideoClips(video.id)} icon={Video}>
              Film scenes
            </Button>
          ) : null}
          <IconButton
            label="Save as a video"
            disabled={Boolean(saving)}
            onClick={() => void save()}
          >
            <Download />
          </IconButton>
          <IconButton label="Delete" onClick={() => void remove()}>
            <Trash2 />
          </IconButton>
        </span>
      </div>
      {scene ? (
        <div ref={stage} className="tutor-video-stage">
          {clip ? (
            <video
              key={clip}
              className="tutor-video-art"
              src={clip}
              aria-label={scene.heading}
              autoPlay
              muted
              loop
              playsInline
            />
          ) : scene.svg ? (
            <img className="tutor-video-art" src={svgUrl(scene.svg)} alt={scene.heading} />
          ) : (
            <div className="tutor-video-fallback">
              <h3>{scene.heading}</h3>
              <ul>
                {(scene.points ?? []).map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="tutor-video-caption">{scene.narration}</p>
        </div>
      ) : null}
      <div className="tutor-slide-controls">
        <IconButton label="Previous scene" disabled={at === 0} onClick={() => setAt(at - 1)}>
          <ChevronLeft />
        </IconButton>
        <IconButton label={playing ? "Pause" : "Play"} onClick={() => setPlaying(!playing)}>
          {playing ? <Pause /> : <Play />}
        </IconButton>
        <IconButton
          label="Next scene"
          disabled={at >= scenes.length - 1}
          onClick={() => setAt(at + 1)}
        >
          <ChevronRight />
        </IconButton>
        <span className="tutor-card-detail">
          {saving
            ? `Saving ${clock(saving.done)} / ${clock(saving.total)}`
            : video.audio?.state === "making"
              ? "Speaking the narration"
              : filming
                ? `Filming scene ${filmingScene} of ${scenes.length}`
                : `Scene ${at + 1} of ${scenes.length} · ${clock(total)}`}
        </span>
        <Button
          variant="quiet"
          className="ml-auto"
          onClick={() => void stage.current?.requestFullscreen?.().catch(() => undefined)}
          icon={Maximize2}
        >
          Full screen
        </Button>
      </div>
      <div className="tutor-video-scenes">
        {scenes.map((item, index) => (
          <Pressable
            key={index}
            className="tutor-video-thumb"
            aria-current={index === at ? "true" : undefined}
            onClick={() => setAt(index)}
          >
            {item.svg ? <img src={svgUrl(item.svg)} alt="" /> : <span>{item.heading}</span>}
          </Pressable>
        ))}
      </div>
      <audio ref={audio} hidden />
    </>
  );
}

/** An infographic the engine drew: shown as an image, fit or at full size, and saved as SVG. */
export function InfographicView({ infographic, onClose }: { infographic: Guide; onClose(): void }) {
  const [full, setFull] = useState(false);
  const [error, setError] = useState("");
  useNotice(Boolean(error), { message: error, tone: "error", onDismiss: () => setError("") });
  const remove = async () => {
    if (!(await confirmAction(`Delete “${infographic.title}”? This can’t be undone.`))) return;
    useTutorStore.getState().removeGuide(infographic.id);
    onClose();
  };
  return (
    <>
      <div className="tutor-lead">
        <IconButton label="Back to Create" onClick={onClose}>
          <ArrowLeft />
        </IconButton>
        <OverflowFadeText className="tutor-card-title">{infographic.title}</OverflowFadeText>
        <span className="tutor-actions">
          <IconButton
            label="Save as SVG"
            onClick={() =>
              void saveBytes(
                new Blob([infographic.body], { type: "image/svg+xml" }),
                infographic.title,
                "svg",
                "SVG image",
              ).catch((reason: unknown) => setError(String(reason)))
            }
          >
            <Download />
          </IconButton>
          <IconButton label="Delete" onClick={() => void remove()}>
            <Trash2 />
          </IconButton>
        </span>
      </div>
      <Pressable
        className="tutor-infographic"
        data-full={full ? "true" : undefined}
        aria-label={full ? "Fit to the panel" : "Show at full size"}
        onClick={() => setFull(!full)}
      >
        <img src={svgUrl(infographic.body)} alt={infographic.title} />
      </Pressable>
    </>
  );
}
