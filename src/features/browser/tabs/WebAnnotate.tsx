import { invoke } from "@tauri-apps/api/core";
import { Circle, Minus, Pencil, Redo2, Square, Undo2 } from "lucide-react";
import { useState } from "react";
import {
  AnnotationCanvas,
  annotationColors,
  Button,
  ColorSwatch,
  FramedBar,
  FramedPage,
  IconButton,
  ToolbarDivider,
  notify,
  renderAnnotatedPicture,
  type AnnotationColor,
  type AnnotationMark,
  type AnnotationTool,
} from "@misty/ui";

const tools: { id: AnnotationTool; label: string; icon: typeof Pencil }[] = [
  { id: "pen", label: "Pen", icon: Pencil },
  { id: "line", label: "Line", icon: Minus },
  { id: "rectangle", label: "Rectangle", icon: Square },
  { id: "ellipse", label: "Ellipse", icon: Circle },
];

export interface WebPicture {
  src: string;
  width: number;
  height: number;
}

export async function takeWebPicture(viewId: string): Promise<WebPicture> {
  const shot = await invoke<{ dataUrl?: string }>("browser_webview_picture", {
    request: { id: viewId, width: 1280 },
  });
  if (!shot.dataUrl) throw new Error("The page's picture couldn't be taken.");
  const image = new Image();
  image.src = shot.dataUrl;
  await image.decode();
  return { src: shot.dataUrl, width: image.naturalWidth, height: image.naturalHeight };
}

export function WebAnnotatePage(props: {
  picture: WebPicture;
  title: string;
  onAddToChat(file: File): Promise<void>;
  onClose(): void;
}) {
  const { picture } = props;
  const [tool, setTool] = useState<AnnotationTool>("pen");
  const [color, setColor] = useState<AnnotationColor>("red");
  const [marks, setMarks] = useState<AnnotationMark[]>([]);
  const [undone, setUndone] = useState<AnnotationMark[]>([]);
  const [sending, setSending] = useState(false);

  const draw = (next: AnnotationMark[]) => {
    setMarks(next);
    setUndone([]);
  };
  const undo = () => {
    const last = marks.at(-1);
    if (!last) return;
    setMarks(marks.slice(0, -1));
    setUndone([...undone, last]);
  };
  const redo = () => {
    const last = undone.at(-1);
    if (!last) return;
    setUndone(undone.slice(0, -1));
    setMarks([...marks, last]);
  };
  const send = async () => {
    setSending(true);
    try {
      const blob = await renderAnnotatedPicture(picture.src, picture.width, picture.height, marks);
      const name = `${(props.title.trim() || "Page").replace(/[\\/:]/g, " ").slice(0, 80)}.png`;
      await props.onAddToChat(new File([blob], name, { type: "image/png" }));
      props.onClose();
    } catch (error) {
      notify({
        message:
          error instanceof Error ? error.message : "The picture couldn't be added to the chat.",
        tone: "error",
      });
    } finally {
      setSending(false);
    }
  };

  const bar = (
    <FramedBar
      size="tools"
      aria-label="Annotation tools"
      start={
        <div className="flex min-w-0 items-center gap-1">
          {tools.map((item) => (
            <IconButton
              key={item.id}
              label={item.label}
              aria-pressed={tool === item.id}
              onClick={() => setTool(item.id)}
            >
              <item.icon />
            </IconButton>
          ))}
          <ToolbarDivider />
          <div role="radiogroup" aria-label="Color" className="flex items-center gap-2">
            {annotationColors.map((item) => (
              <ColorSwatch
                key={item.id}
                radio
                label={item.label}
                color={`var(${item.token})`}
                selected={color === item.id}
                onClick={() => setColor(item.id)}
              />
            ))}
          </div>
          <ToolbarDivider />
          <IconButton label="Undo" disabled={!marks.length} onClick={undo}>
            <Undo2 />
          </IconButton>
          <IconButton label="Redo" disabled={!undone.length} onClick={redo}>
            <Redo2 />
          </IconButton>
        </div>
      }
    >
      <Button variant="quiet" onClick={props.onClose}>
        Cancel
      </Button>
      <Button variant="primary" disabled={!marks.length || sending} onClick={() => void send()}>
        Add to chat
      </Button>
    </FramedBar>
  );

  return (
    <FramedPage toolbar={bar}>
      <AnnotationCanvas
        className="min-h-0 flex-1 p-4"
        label="Marked-up page"
        picture={picture.src}
        width={picture.width}
        height={picture.height}
        tool={tool}
        color={color}
        marks={marks}
        onMarksChange={draw}
      />
    </FramedPage>
  );
}
