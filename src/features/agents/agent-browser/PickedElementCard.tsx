import { Check, SendHorizontal } from "lucide-react";
import {
  Button,
  ColorChip,
  OverflowFadeText,
  Separator,
  Surface,
  Text,
  Tooltip,
} from "@misty/ui";
import { sizeLabel, styleNames } from "./picked_element";
import type { PagePick } from "./pick_api";

const shownStyles = styleNames.filter((name) => name !== "width" && name !== "height");

export function PickedElementCard({
  pick,
  sent,
  onSend,
  onClear,
}: {
  pick: PagePick;
  sent: boolean;
  onSend(): void;
  onClear(): void;
}) {
  const { element, image } = pick;
  return (
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
              <OverflowFadeText as="code" className="preview-card-selector">
                {element.selector}
              </OverflowFadeText>
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
        <dl className="preview-card-styles m-0 grid gap-1 text-caption">
          {shownStyles.map((name) =>
            element.styles[name] ? (
              <div key={name} className="flex min-w-0 gap-2">
                <Text as="dt" bare tone="muted" className="w-17 flex-none">
                  {name}
                </Text>
                <Tooltip content={element.styles[name]}>
                  <OverflowFadeText as="dd">
                    {name === "color" || name === "background" ? (
                      <ColorChip color={element.styles[name]} />
                    ) : null}
                    {element.styles[name]}
                  </OverflowFadeText>
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
