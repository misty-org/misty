/**
 * Inserts dictated text into the field focused in Misty's own window, the way
 * typing would, without touching the clipboard. Returns false when nothing
 * editable has focus here (for example a web page in a tab has it).
 */
export function insertIntoFocusedField(text: string, doc: Document = document): boolean {
  const element = doc.activeElement;
  if (!element || element === doc.body) return false;
  if (element instanceof HTMLTextAreaElement || isTextInput(element)) {
    const field = element as HTMLInputElement | HTMLTextAreaElement;
    if (field.readOnly || field.disabled) return false;
    const start = field.selectionStart ?? field.value.length;
    const end = field.selectionEnd ?? start;
    const before = field.value.slice(0, start);
    const spaced = before && !/\s$/.test(before) && !/^[\s,.!?;:]/.test(text) ? ` ${text}` : text;
    // The native setter keeps React's controlled inputs in step.
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")?.set;
    const next = before + spaced + field.value.slice(end);
    if (setter) setter.call(field, next);
    else field.value = next;
    const caret = start + spaced.length;
    field.setSelectionRange(caret, caret);
    field.dispatchEvent(
      new InputEvent("input", { bubbles: true, inputType: "insertText", data: spaced }),
    );
    return true;
  }
  if (element instanceof HTMLElement && element.isContentEditable) {
    return doc.execCommand("insertText", false, text);
  }
  return false;
}

function isTextInput(element: Element): element is HTMLInputElement {
  return (
    element instanceof HTMLInputElement &&
    ["text", "search", "url", "email", "tel", ""].includes(element.type) &&
    element.autocomplete !== "cc-number"
  );
}
