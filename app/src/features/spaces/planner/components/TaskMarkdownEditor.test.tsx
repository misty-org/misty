import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskMarkdownEditor } from "./TaskMarkdownEditor";
import { TaskDatePicker } from "./TaskDatePicker";

describe("TaskMarkdownEditor", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document.body.innerHTML = "";
  });

  it("renders md editor with textarea and placeholder", async () => {
    const onChange = vi.fn();
    await act(async () => {
      root.render(
        <TaskMarkdownEditor value="" placeholder="Add description" onChange={onChange} />,
      );
    });

    const textarea = container.querySelector("textarea");
    expect(textarea).not.toBeNull();
    expect(textarea?.getAttribute("placeholder")).toBe("Add description");
  });

  it("renders with initial value and reflects content in editor", async () => {
    const onChange = vi.fn();
    await act(async () => {
      root.render(
        <TaskMarkdownEditor
          value="### Task Notes&#10;- [ ] Checklist item"
          onChange={onChange}
        />,
      );
    });

    const textarea = container.querySelector("textarea");
    expect(textarea).not.toBeNull();
    expect(textarea?.value).toContain("Task Notes");
  });

  it("switches to split and preview modes with custom mode commands", async () => {
    const onChange = vi.fn();
    await act(async () => {
      root.render(
        <TaskMarkdownEditor value="### Hello world" onChange={onChange} defaultPreview="edit" />,
      );
    });

    const splitBtn = container.querySelector('button[aria-label="Split view"]');
    expect(splitBtn).not.toBeNull();

    await act(async () => {
      splitBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // In split mode, the preview pane is rendered alongside the textarea
    const preview = container.querySelector(".w-md-editor-preview");
    expect(preview).not.toBeNull();
    expect(preview?.textContent).toContain("Hello world");
  });
});

describe("TaskDatePicker", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document.body.innerHTML = "";
  });

  it("renders trigger button with placeholder when empty", async () => {
    const onChange = vi.fn();
    await act(async () => {
      root.render(<TaskDatePicker value="" onChange={onChange} />);
    });

    expect(container.textContent).toContain("Set due date");
  });

  it("renders formatted date when value is provided", async () => {
    const onChange = vi.fn();
    const targetDate = "2026-08-25T17:00:00.000Z";
    await act(async () => {
      root.render(<TaskDatePicker value={targetDate} onChange={onChange} />);
    });

    expect(container.textContent).toMatch(/Aug 25|Today|Tomorrow/i);
  });
});
