import { useEffect, useState } from "react";
import { SetupState, lazyTool, ToolSuspense } from "@/shared/ui";
import { EditorPane } from "../EditorPane";
import { loadOpencutWasm } from "@opencut/wasm/load";
import { canEditVideo, VIDEO_EDITING_UNAVAILABLE } from "./support";
import type { VideoEditorProps } from "./videoEditorTypes";

// The editor itself reads OpenCut's core as its modules load, so it loads after the core.
const VideoEditorSession = lazyTool(() => import("./VideoEditorSession"));

/**
 * Misty's video editor: OpenCut's editor (vendor/opencut), laid out as OpenCut lays it out,
 * in the page that opened it. It opens a file as a new video with that file on its timeline;
 * exporting saves the finished video where the opener says.
 */
export function VideoEditor(props: VideoEditorProps) {
  const [core, setCore] = useState<"loading" | "ready" | Error>("loading");
  // Trying again loads the core once more.
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    loadOpencutWasm().then(
      () => live && setCore("ready"),
      (reason: unknown) =>
        live &&
        setCore(reason instanceof Error ? reason : new Error("The editor could not start.")),
    );
    return () => {
      live = false;
    };
  }, [attempt]);
  // A web view that can't encode video can't edit it; trying again wouldn't change that.
  if (!canEditVideo())
    return (
      <EditorPane name={props.name} onEscape={props.onClose}>
        <SetupState tool="video editor" error={new Error(VIDEO_EDITING_UNAVAILABLE)} />
      </EditorPane>
    );
  return (
    <EditorPane name={props.name} onEscape={props.onClose}>
      {core === "ready" ? (
        <ToolSuspense tool="video editor">
          <VideoEditorSession {...props} />
        </ToolSuspense>
      ) : (
        <SetupState
          tool="video editor"
          error={core instanceof Error ? core : null}
          onRetry={() => {
            setCore("loading");
            setAttempt((value) => value + 1);
          }}
        />
      )}
    </EditorPane>
  );
}

/** The editor in its page, setting up, while what it opens is still being reached. */
export function VideoEditorOpening(props: { name: string; onClose: () => void }) {
  return (
    <EditorPane name={props.name} onEscape={props.onClose}>
      <SetupState tool="video editor" />
    </EditorPane>
  );
}
