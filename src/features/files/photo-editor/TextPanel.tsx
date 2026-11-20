import { Button } from "@misty/ui";
import type { MarkStyle } from "./editorTypes";
import { MarkStyleControls } from "./MarkStyleControls";
import { PhotoPanelView } from "./PhotoPanelView";

/**
 * The Text tab: words on the image. A click on the image writes there, a click on a text picks it
 * to drag and opens it to edit, and Add text writes in the middle of the image. Its look is how
 * the next text is written; a picked text's own look is in the properties panel.
 */
export function TextPanel(props: {
  style: MarkStyle;
  onStyle: (style: Partial<MarkStyle>) => void;
  onAdd: () => void;
}) {
  return (
    <PhotoPanelView title="Text">
      <Button variant="secondary" onClick={props.onAdd}>
        Add text
      </Button>
      <MarkStyleControls marks={[]} tool="text" style={props.style} onStyle={props.onStyle} />
    </PhotoPanelView>
  );
}
