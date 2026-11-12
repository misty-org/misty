import { Check, SendHorizontal } from "lucide-react";
import { Button } from "@/shared/ui";
import { sizeLabel, styleNames } from "./pickedElement";
import type { PreviewPick } from "./previewApi";

/** The styles worth a glance in the card; the message to the agent carries all of them. */
const shownStyles = styleNames.filter((name) => name !== "width" && name !== "height");

/** A color value's swatch, so `rgb(…)` reads as the color it is. */
function Swatch({ color }: { color: string }) {
  return <span className="preview-swatch" style={{ background: color }} aria-hidden="true" />;
}

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
    <section className="preview-card" aria-label="Picked element">
      <div className="preview-card-head">
        {image ? <img className="preview-card-picture" src={image} alt="" /> : null}
        <div className="min-w-0 flex-1">
          <code className="preview-card-selector" title={element.selector}>
            {element.selector}
          </code>
          <div className="preview-card-size">
            <span>{element.tag}</span>
            <span>{sizeLabel(element)}</span>
            {element.errors.length ? (
              <span data-errors="">
                {element.errors.length} {element.errors.length === 1 ? "error" : "errors"}
              </span>
            ) : null}
          </div>
        </div>
      </div>
      <dl className="preview-card-styles">
        {shownStyles.map((name) =>
          element.styles[name] ? (
            <div key={name}>
              <dt>{name}</dt>
              <dd title={element.styles[name]}>
                {name === "color" || name === "background" ? (
                  <Swatch color={element.styles[name]} />
                ) : null}
                {element.styles[name]}
              </dd>
            </div>
          ) : null,
        )}
      </dl>
      <div className="preview-card-actions">
        <Button type="button" variant="quiet" onClick={onClear}>
          Clear
        </Button>
        <Button type="button" onClick={onSend} disabled={sent}>
          {sent ? <Check size={14} /> : <SendHorizontal size={14} />}
          <span>{sent ? "Added to your message" : "Send to agent"}</span>
        </Button>
      </div>
    </section>
  );
}
