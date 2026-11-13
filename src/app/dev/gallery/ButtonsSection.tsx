import {
  Button,
  IconButton,
  Tooltip,
  type ButtonSize,
  type ButtonVariant,
  type IconButtonSize,
  type IconButtonVariant,
} from "@/shared/ui";
import { ArrowRight, Download, Pause, Play, Plus, Star, Trash2 } from "lucide-react";
import { useState } from "react";
import { GalleryMatrix, GalleryRow, GallerySection, GalleryStage } from "./GalleryLayout";

const buttonVariants: ReadonlyArray<ButtonVariant> = ["primary", "secondary", "quiet", "danger"];
const buttonSizes: ReadonlyArray<ButtonSize> = ["sm", "md", "lg"];
const sizePx: Record<ButtonSize, number> = { sm: 24, md: 32, lg: 36 };

const iconVariants: ReadonlyArray<Exclude<IconButtonVariant, "overlay">> = [
  "quiet",
  "secondary",
  "primary",
  "danger",
];
const iconSizes: ReadonlyArray<IconButtonSize> = ["sm", "md"];

function sampleLabel(variant: ButtonVariant) {
  return variant === "danger" ? "Delete" : variant === "primary" ? "New chat" : "Open";
}

function sampleIcon(variant: ButtonVariant) {
  return variant === "danger" ? Trash2 : variant === "primary" ? Plus : undefined;
}

export function ButtonsSection() {
  return (
    <GallerySection title="Buttons">
      <GalleryMatrix
        columns={buttonSizes.map((size) => `${size} · ${sizePx[size]}px`)}
        rows={buttonVariants.map((variant) => ({
          label: variant,
          cells: buttonSizes.map((size) => (
            <Button key={size} variant={variant} size={size} icon={sampleIcon(variant)}>
              {sampleLabel(variant)}
            </Button>
          )),
        }))}
      />
      <GalleryMatrix
        columns={buttonSizes.map((size) => `${size} · ${sizePx[size]}px`)}
        rows={[
          ...buttonVariants.map((variant) => ({
            label: `${variant}, loading`,
            cells: buttonSizes.map((size) => (
              <Button key={size} variant={variant} size={size} icon={sampleIcon(variant)} loading>
                {sampleLabel(variant)}
              </Button>
            )),
          })),
          ...buttonVariants.map((variant) => ({
            label: `${variant}, disabled`,
            cells: buttonSizes.map((size) => (
              <Button key={size} variant={variant} size={size} icon={sampleIcon(variant)} disabled>
                {sampleLabel(variant)}
              </Button>
            )),
          })),
        ]}
      />
      <GalleryRow label="Icon at the end">
        <Button variant="quiet" iconEnd={ArrowRight}>
          Open
        </Button>
        <Button variant="secondary" iconEnd={ArrowRight}>
          Continue
        </Button>
      </GalleryRow>
      <LoadingButtonRow />
      <IconButtonsRows />
    </GallerySection>
  );
}

function LoadingButtonRow() {
  const [saving, setSaving] = useState(false);
  const save = () => {
    setSaving(true);
    window.setTimeout(() => setSaving(false), 1500);
  };
  return (
    <GalleryRow label="Loading on click">
      <Button variant="primary" loading={saving} onClick={save}>
        Save
      </Button>
      <Button variant="danger" icon={Trash2} loading={saving} onClick={save}>
        Delete
      </Button>
    </GalleryRow>
  );
}

function IconButtonsRows() {
  const [starred, setStarred] = useState(false);
  const [playing, setPlaying] = useState(false);
  return (
    <>
      <GalleryMatrix
        columns={iconSizes.map((size) => `${size} · ${size === "sm" ? 24 : 32}px`)}
        rows={iconVariants.map((variant) => ({
          label: `IconButton ${variant}`,
          cells: iconSizes.map((size) => (
            <IconButton
              key={size}
              variant={variant}
              size={size}
              label={variant === "danger" ? "Delete" : "Download"}
            >
              {variant === "danger" ? <Trash2 /> : <Download />}
            </IconButton>
          )),
        }))}
      />
      <GalleryRow label="Tooltip and shortcut">
        <IconButton label="New chat" shortcut="⌘N" onClick={() => {}}>
          <Plus />
        </IconButton>
        <IconButton label="Download" tooltipSide="bottom">
          <Download />
        </IconButton>
        <Tooltip content="Any element can carry Misty's tooltip" shortcut="⌘K">
          <Button variant="quiet">Hover me</Button>
        </Tooltip>
      </GalleryRow>
      <GalleryRow label="IconButton states">
        <IconButton
          label={starred ? "Remove star" : "Star"}
          aria-pressed={starred}
          data-active={starred || undefined}
          onClick={() => setStarred((value) => !value)}
        >
          <Star fill={starred ? "currentColor" : "none"} />
        </IconButton>
        <IconButton label="Downloading" loading>
          <Download />
        </IconButton>
        <IconButton label="Download" disabled>
          <Download />
        </IconButton>
      </GalleryRow>
      <GalleryRow label="IconButton overlay">
        <GalleryStage className="grid h-16 w-28 place-items-center">
          <IconButton
            variant="overlay"
            label={playing ? "Pause" : "Play"}
            onClick={() => setPlaying((value) => !value)}
          >
            {playing ? <Pause /> : <Play />}
          </IconButton>
        </GalleryStage>
      </GalleryRow>
    </>
  );
}
