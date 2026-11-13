import type { KeyboardEvent, ReactNode, Ref } from "react";
import { FieldError } from "../controls/Field";
import { Text } from "../display/Text";

export type QuestionPanelProps = {
  /** The panel's accessible name, such as "Misty is asking". */
  label: string;
  /** What is asked, in the person's words. */
  title: ReactNode;
  /** Quiet words at the right of the title row, such as "2 of 3". */
  aside?: ReactNode;
  /** A control at the end of the title row, such as a 24px hide IconButton. */
  end?: ReactNode;
  /** The answers: a ChoiceList, an Input for one's own words, or both. */
  children?: ReactNode;
  /** The buttons in one 32px row: a BackButton, then the one primary action, then a quiet one. */
  actions?: ReactNode;
  /** Why answering failed, shown under the answers. */
  error?: string;
  panelRef?: Ref<HTMLDivElement>;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
};

/**
 * A question or approval waiting on the person, flat between hairlines above the composer: what is
 * asked, the choices, then the buttons in one row. Questions from Misty, from an outside engine
 * and from an action that needs an OK all use it.
 *
 * ```tsx
 * <QuestionPanel label="Misty is asking" title={question.text} aside="1 of 3"
 *   actions={<Button variant="primary" onClick={next}>Next</Button>}>
 *   <ChoiceList label={question.text} options={question.options} selected={picked} onSelect={pick} />
 * </QuestionPanel>
 * ```
 */
export function QuestionPanel(props: QuestionPanelProps) {
  return (
    <div
      ref={props.panelRef}
      role="group"
      aria-label={props.label}
      data-slot="question-panel"
      className="mb-2 grid gap-2 border-y border-charcoal-border py-3"
      onKeyDown={props.onKeyDown}
    >
      <div className="flex min-h-6 items-center gap-2">
        <div className="min-w-0 flex-1 text-control">{props.title}</div>
        {props.aside ? (
          <Text size="meta" tone="muted" className="shrink-0" aria-live="polite">
            {props.aside}
          </Text>
        ) : null}
        {props.end}
      </div>
      {props.children}
      <FieldError message={props.error} />
      {props.actions ? <div className="flex h-8 items-center gap-2">{props.actions}</div> : null}
    </div>
  );
}
