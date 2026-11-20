import { useState } from "react";
import { Button, Field, FieldError, Input, OptionSelect, Switch, Text } from "@misty/ui";
import { croppedSize, maxSide, outputSize, type ImageEdit, type Resize } from "./imageEdit";
import { defaultQuality, imageFormats, type ImageMimeType, type SaveFormat } from "./imageRender";
import { PanelSection, PanelSlider, PhotoPanelView } from "./PhotoPanelView";

type Size = { width: number; height: number };

const formatOptions = imageFormats.map((format) => ({
  value: format.mimeType,
  label: format.label,
}));

/**
 * The Size tab, as Preview's Adjust Size: the width and height the image saves at, in pixels,
 * kept in proportion unless that is turned off. Kept in proportion it is a scale of the crop and
 * follows any later crop; otherwise it is exact pixels. Under it, the format Save, Save as copy
 * and Download write, and for JPEG and WebP how much detail they keep.
 */
export function SizePanel(props: {
  edit: ImageEdit;
  /** The original's size in pixels. */
  natural: Size;
  onResize: (resize: Resize | null) => void;
  format: SaveFormat;
  onFormat: (format: SaveFormat) => void;
}) {
  const current = outputSize(props.natural, props.edit);
  // A new crop or turn starts the fields again from the size the image saves at now.
  return (
    <SizeFields
      key={`${current.width}x${current.height}:${JSON.stringify(props.edit.resize)}`}
      {...props}
      current={current}
    />
  );
}

function SizeFields(props: {
  edit: ImageEdit;
  natural: Size;
  current: Size;
  onResize: (resize: Resize | null) => void;
  format: SaveFormat;
  onFormat: (format: SaveFormat) => void;
}) {
  const { edit, natural, current } = props;
  const base = croppedSize(natural, edit);
  const [width, setWidth] = useState(String(current.width));
  const [height, setHeight] = useState(String(current.height));
  const [linked, setLinked] = useState(!edit.resize || "scale" in edit.resize);
  const typedWidth = Math.round(Number(width));
  const typedHeight = Math.round(Number(height));
  const valid =
    Number.isFinite(typedWidth) &&
    Number.isFinite(typedHeight) &&
    typedWidth >= 1 &&
    typedHeight >= 1 &&
    typedWidth <= maxSide &&
    typedHeight <= maxSide;
  const unchanged = typedWidth === current.width && typedHeight === current.height;
  const proportional = (value: number, to: number, from: number) =>
    String(Math.max(1, Math.round((value * to) / from)));

  const typeWidth = (value: string) => {
    const digits = value.replace(/[^\d]/g, "");
    setWidth(digits);
    if (linked && digits) setHeight(proportional(Number(digits), base.height, base.width));
  };
  const typeHeight = (value: string) => {
    const digits = value.replace(/[^\d]/g, "");
    setHeight(digits);
    if (linked && digits) setWidth(proportional(Number(digits), base.width, base.height));
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
  };

  return (
    <PhotoPanelView
      title="Size"
      actions={
        edit.resize ? (
          <Button size="sm" variant="quiet" onClick={() => props.onResize(null)}>
            Original size
          </Button>
        ) : null
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          apply();
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="Width">
            <Input
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
                setHeight(proportional(Number(width), base.height, base.width));
            }}
          />
        </label>
        {!valid && (width || height) ? (
          <FieldError message={`Width and height are 1 to ${maxSide} pixels.`} />
        ) : null}
        <Button type="submit" variant="secondary" disabled={!valid || unchanged}>
          Resize
        </Button>
      </form>
      <FormatFields format={props.format} onFormat={props.onFormat} />
    </PhotoPanelView>
  );
}

function FormatFields(props: { format: SaveFormat; onFormat: (format: SaveFormat) => void }) {
  const { format } = props;
  const lossy = imageFormats.find((candidate) => candidate.mimeType === format.mimeType)?.lossy;
  return (
    <PanelSection title="Format">
      <OptionSelect
        aria-label="Format"
        value={format.mimeType}
        options={formatOptions}
        onValueChange={(value) => props.onFormat({ ...format, mimeType: value as ImageMimeType })}
      />
      {lossy ? (
        <PanelSlider
          label="Quality"
          value={Math.round(format.quality * 100)}
          min={40}
          max={100}
          rest={Math.round(defaultQuality * 100)}
          unit="%"
          onPreview={(value) => props.onFormat({ ...format, quality: value / 100 })}
          onCommit={() => undefined}
        />
      ) : null}
    </PanelSection>
  );
}

/**
 * The Remove background tab, where this computer can find a photo's subject: the edited image
 * with only its subject left, saved to Media as a new PNG beside this one.
 */
export function CutoutPanel(props: { busy: boolean; readonly: boolean; onCutOut: () => void }) {
  return (
    <PhotoPanelView title="Remove background">
      <Text as="p" size="control" tone="muted" wrap>
        Keeps only the subject, over transparency, and saves it to Media as a copy.
      </Text>
      <Button variant="secondary" disabled={props.busy || props.readonly} onClick={props.onCutOut}>
        Remove background
      </Button>
    </PhotoPanelView>
  );
}
