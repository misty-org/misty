import { Input, Surface, Text } from "@/shared/ui";
import { editKeyAction, type Direction } from "./selection";

/**
 * The thin row under the toolbar: the selected cell's name and what it holds (a formula in
 * A1). Typing here edits the cell, the same as typing in it.
 */
export function FormulaBar(props: {
  name: string;
  text: string;
  canEdit: boolean;
  onStart(): void;
  onChange(text: string): void;
  onCommit(direction: Direction | null): void;
  onCancel(): void;
}) {
  return (
    <Surface tone="page" className="flex h-8 shrink-0 items-center border-b">
      <div className="flex h-full w-20 shrink-0 items-center border-r px-3">
        <Text size="control" tone="muted" className="tabular-nums" aria-label="Selected cell">
          {props.name}
        </Text>
      </div>
      <div className="flex h-full min-w-0 flex-1 items-center px-3">
        <Input
          variant="bare"
          aria-label="Cell contents"
          value={props.text}
          readOnly={!props.canEdit}
          spellCheck={false}
          autoComplete="off"
          onFocus={() => {
            if (props.canEdit) props.onStart();
          }}
          onChange={(event) => props.onChange(event.target.value)}
          onKeyDown={(event) => {
            const action = editKeyAction(event, "edit");
            if (!action) return;
            event.preventDefault();
            if (action.type === "cancel") props.onCancel();
            else
              props.onCommit(
                action.direction === "down" || action.direction === "up" ? action.direction : null,
              );
            (event.currentTarget as HTMLInputElement).blur();
          }}
          onBlur={() => props.onCommit(null)}
        />
      </div>
    </Surface>
  );
}
