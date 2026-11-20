import { useEffect, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Pressable,
  Surface,
} from "@misty/ui";
import { useDeckAssetUrl } from "../render/renderHooks";

/**
 * Picks the point of an image that stays in view when its slot crops it: click it on the whole
 * image, then Done.
 */
export function FocalPointDialog(props: {
  open: boolean;
  onOpenChange(open: boolean): void;
  spaceId: string;
  deckId: string;
  assetId: string;
  focal: { x: number; y: number };
  onSave(focal: { x: number; y: number }): void;
}) {
  const asset = useDeckAssetUrl(props.spaceId, props.deckId, props.assetId);
  const [focal, setFocal] = useState(props.focal);
  const { x, y } = props.focal;
  useEffect(() => {
    if (props.open) setFocal({ x, y });
  }, [props.open, x, y]);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Adjust crop</DialogTitle>
        </DialogHeader>
        {asset.url ? (
          <Pressable
            aria-label="Pick the point that stays in view"
            className="relative mx-auto block w-full"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              if (!rect.width || !rect.height) return;
              setFocal({
                x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
                y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
              });
            }}
          >
            <img src={asset.url} alt="" draggable={false} className="block w-full" />
            <Surface
              tone="none"
              edge="bright"
              radius="full"
              className="pointer-events-none absolute size-6"
              // Half the mark's 24px off the point, in whole pixels.
              style={{
                left: `calc(${focal.x * 100}% - 12px)`,
                top: `calc(${focal.y * 100}% - 12px)`,
              }}
            />
          </Pressable>
        ) : (
          <Surface tone="well" radius="md" className="aspect-video w-full" />
        )}
        <DialogFooter>
          <Button variant="quiet" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!asset.url}
            onClick={() => {
              props.onSave(focal);
              props.onOpenChange(false);
            }}
          >
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
