import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldError,
  Input,
  Switch,
  Text,
} from "@/shared/ui";
import { useEffect, useState } from "react";
import { croppedSize, maxSide, outputSize, type ImageEdit, type Resize } from "./imageEdit";

/**
 * The size the image saves at, as Preview's Adjust Size: width and height in pixels, kept in
 * proportion unless that is turned off. Kept in proportion, it is a scale of the crop and follows
 * any later crop; otherwise it is exact pixels.
 */
export function ResizeDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  edit: ImageEdit;
  /** The original's size in pixels. */
  natural: { width: number; height: number };
  onResize: (resize: Resize | null) => void;
}) {
  const { edit, natural } = props;
  const base = croppedSize(natural, edit);
  const current = outputSize(natural, edit);
  const [width, setWidth] = useState(String(current.width));
  const [height, setHeight] = useState(String(current.height));
  const [linked, setLinked] = useState(true);
  // Each time it opens it starts from the size the image saves at now.
  useEffect(() => {
    if (!props.open) return;
    setWidth(String(current.width));
    setHeight(String(current.height));
    setLinked(!edit.resize || "scale" in edit.resize);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on opening.
  }, [props.open]);

  const typedWidth = Math.round(Number(width));
  const typedHeight = Math.round(Number(height));
  const valid =
    Number.isFinite(typedWidth) &&
    Number.isFinite(typedHeight) &&
    typedWidth >= 1 &&
    typedHeight >= 1 &&
    typedWidth <= maxSide &&
    typedHeight <= maxSide;

  const typeWidth = (value: string) => {
    const digits = value.replace(/[^\d]/g, "");
    setWidth(digits);
    if (linked && digits)
      setHeight(String(Math.max(1, Math.round((Number(digits) * base.height) / base.width))));
  };
  const typeHeight = (value: string) => {
    const digits = value.replace(/[^\d]/g, "");
    setHeight(digits);
    if (linked && digits)
      setWidth(String(Math.max(1, Math.round((Number(digits) * base.width) / base.height))));
  };
  const apply = () => {
    if (!valid) return;
    const scale = typedWidth / base.width;
    if (linked) props.onResize(Math.abs(scale - 1) < 1e-6 ? null : { scale });
    else
      props.onResize(
        typedWidth === base.width && typedHeight === base.height
          ? null
          : { width: typedWidth, height: typedHeight },
      );
    props.onOpenChange(false);
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent size="sm" aria-describedby={undefined}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            apply();
          }}
        >
          <DialogHeader>
            <DialogTitle>Resize image</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Width">
              <Input
                autoFocus
                inputMode="numeric"
                value={width}
                onChange={(event) => typeWidth(event.target.value)}
                onFocus={(event) => event.target.select()}
              />
            </Field>
            <Field label="Height">
              <Input
                inputMode="numeric"
                value={height}
                onChange={(event) => typeHeight(event.target.value)}
                onFocus={(event) => event.target.select()}
              />
            </Field>
          </div>
          <label className="flex items-center justify-between gap-3">
            <Text size="control" tone="default">
              Keep proportions
            </Text>
            <Switch
              checked={linked}
              onCheckedChange={(checked) => {
                setLinked(checked);
                if (checked && Number(width) > 0)
                  setHeight(
                    String(Math.max(1, Math.round((Number(width) * base.height) / base.width))),
                  );
              }}
            />
          </label>
          {!valid && (width || height) ? (
            <FieldError message={`Width and height are 1 to ${maxSide} pixels.`} />
          ) : null}
          <DialogFooter>
            {edit.resize ? (
              <Button
                type="button"
                variant="quiet"
                size="lg"
                onClick={() => {
                  props.onResize(null);
                  props.onOpenChange(false);
                }}
              >
                Original size
              </Button>
            ) : null}
            <Button
              type="button"
              variant="quiet"
              size="lg"
              onClick={() => props.onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="lg" disabled={!valid}>
              Resize
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
