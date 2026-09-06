import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MistyFilePicker } from "./picker";
import { takeSelectedFile } from "./selectedFiles";

afterEach(cleanup);
it("opens without desktop providers and exposes only explicitly chosen files", () => {
  const selected = vi.fn();
  const view = render(<MistyFilePicker mode="file" onCancel={vi.fn()} onSelect={selected} />);
  const file = new File(["example"], "example.txt", { type: "text/plain" });
  fireEvent.change(view.getByLabelText("Choose files from your device"), { target: { files: [file] } });
  const path = selected.mock.calls[0][0];
  expect(takeSelectedFile("/etc/passwd")).toBeUndefined();
  expect(takeSelectedFile(path)).toBe(file);
  expect(takeSelectedFile(path)).toBeUndefined();
});
