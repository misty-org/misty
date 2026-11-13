import { Check, SendHorizontal } from "lucide-react";
import { Button, ColorChip, Separator, Surface, Text, Tooltip } from "@/shared/ui";
import { sizeLabel, styleNames } from "./pickedElement";
import type { PreviewPick } from "./previewApi";

/** The styles worth a glance in the card; the message to the agent carries all of them. */
const shownStyles = styleNames.filter((name) => name !== "width" && name !== "height");

/**
 * The element the person picked: where it is, how big, and the styles that matter, with the
 * choice to put it in the chat's composer or drop it.
 */
export function PickedElementCard({
  pick,
  sent,
  onSend,
  onClear,
}: {
  pick: PreviewPick;
  /** Its details are already in the composer. */
  sent: boolean;
  onSend(): void;
  onClear(): void;
}) {
  const { element, image } = pick;
  return (
    // Painted, like everything in the panel but the page, so the page shows only through its frame.
    <Surface
      as="section"
      tone="sidebar"
      className="flex max-h-[46%] flex-none flex-col"
      aria-label="Picked element"
    >
      <Separator />
      <div className="flex min-h-0 flex-col gap-2.5 overflow-y-auto p-3">
        <div className="flex min-w-0 items-center gap-2.5">
          {image ? (
            <Surface tone="well" radius="md" className="h-10 w-14 flex-none overflow-hidden">
              <img className="size-full object-contain" src={image} alt="" />
            </Surface>
          ) : null}
          <div className="min-w-0 flex-1">
            <Tooltip content={element.selector}>
              <code className="preview-card-selector">{element.selector}</code>
            </Tooltip>
            <Text
              bare
              as="div"
              size="caption"
              tone="muted"
              className="mt-0.5 flex gap-2.5 tabular-nums"
            >
              <span>{element.tag}</span>
              <span>{sizeLabel(element)}</span>
              {element.errors.length ? (
                <Text bare tone="removed" data-errors="">
                  {element.errors.length} {element.errors.length === 1 ? "error" : "errors"}
                </Text>
              ) : null}
            </Text>
          </div>
        </div>
        {/* preview-card-styles: codeViews.css sets the values in the code font. */}
        <dl className="preview-card-styles m-0 grid gap-1 text-caption">
          {shownStyles.map((name) =>
            element.styles[name] ? (
              <div key={name} className="flex min-w-0 gap-2">
                <Text as="dt" bare tone="muted" className="w-17 flex-none">
                  {name}
                </Text>
                <Tooltip content={element.styles[name]}>
                  <dd>
                    {name === "color" || name === "background" ? (
                      <ColorChip color={element.styles[name]} />
                    ) : null}
                    {element.styles[name]}
                  </dd>
                </Tooltip>
              </div>
            ) : null,
          )}
        </dl>
        <div className="flex justify-end gap-1.5">
          <Button type="button" variant="quiet" onClick={onClear}>
            Clear
          </Button>
          <Button type="button" onClick={onSend} disabled={sent}>
            {sent ? <Check /> : <SendHorizontal />}
            <span>{sent ? "Added to your message" : "Send to agent"}</span>
          </Button>
        </div>
      </div>
    </Surface>
  );
}
