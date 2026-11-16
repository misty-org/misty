import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  OptionSelect,
  Slider,
  Text,
} from "@/shared/ui";
import { useEffect, useState } from "react";
import { imageFormats, type ImageMimeType } from "./imageRender";

export interface SaveAsChoice {
  filename: string;
  mimeType: ImageMimeType;
  /** 0 to 1, for the formats that trade size for detail. */
  quality: number;
}

const formatOptions = imageFormats.map((format) => ({
  value: format.mimeType,
  label: format.label,
}));

/** The name an edited image is offered under: its own, marked as edited, without an extension. */
function suggestedName(name: string) {
  const stem = name.replace(/\.[^./\\]+$/, "").trim() || "Image";
  return `${stem} edited`;
}

/**
 * Saves the edited image as a new file in the Library: its name, its format and, for JPEG and
 * WebP, how much detail it keeps.
 */
export function SaveAsDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The image's own name, which the new one starts from. */
  name: string;
  /** The format it would save in otherwise. */
  mimeType: string;
  size: { width: number; height: number };
  busy: boolean;
  onSave: (choice: SaveAsChoice) => void;
}) {
  const startFormat = (imageFormats.find((format) => format.mimeType === props.mimeType)
    ?.mimeType ?? "image/png") as ImageMimeType;
  const [name, setName] = useState(() => suggestedName(props.name));
  const [mimeType, setMimeType] = useState<ImageMimeType>(startFormat);
  const [quality, setQuality] = useState(90);
  // Each time it opens it starts from the image's own name and format.
  useEffect(() => {
    if (!props.open) return;
    setName(suggestedName(props.name));
    setMimeType(startFormat);
    setQuality(90);
  }, [props.name, props.open, startFormat]);

  const format =
    imageFormats.find((candidate) => candidate.mimeType === mimeType) ?? imageFormats[0];
  const stem = name.trim().replace(/\.(png|jpe?g|webp)$/i, "");
  const empty = !stem;

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open && props.busy) return;
        props.onOpenChange(open);
      }}
    >
      <DialogContent size="sm" aria-describedby={undefined}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (empty || props.busy) return;
            props.onSave({
              filename: `${stem}.${format.extension}`,
              mimeType: format.mimeType,
              quality: quality / 100,
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>Save as</DialogTitle>
          </DialogHeader>
          <Field label="Name">
            <Input
              autoFocus
              value={name}
              disabled={props.busy}
              onChange={(event) => setName(event.target.value)}
              onFocus={(event) => event.target.select()}
            />
          </Field>
          <Field label="Format">
            <OptionSelect
              value={mimeType}
              options={formatOptions}
              disabled={props.busy}
              onValueChange={(value) => setMimeType(value as ImageMimeType)}
            />
          </Field>
          {format.lossy ? (
            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <Text size="control" tone="default">
                  Quality
                </Text>
                <Text size="meta" tone="muted" className="tabular-nums">
                  {`${quality}%`}
                </Text>
              </div>
              <Slider
                aria-label="Quality"
                value={[quality]}
                min={40}
                max={100}
                step={1}
                disabled={props.busy}
                onValueChange={([next]) => setQuality(next ?? quality)}
              />
            </div>
          ) : null}
          <Text size="meta" tone="muted" className="tabular-nums">
            {`${props.size.width} × ${props.size.height} px`}
          </Text>
          <DialogFooter>
            <Button
              type="button"
              variant="quiet"
              size="lg"
              disabled={props.busy}
              onClick={() => props.onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="lg" loading={props.busy} disabled={empty}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
