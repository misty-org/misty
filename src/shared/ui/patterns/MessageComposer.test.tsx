import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Cpu, Folder, GitBranch, Layers, Plus } from "lucide-react";
import { afterEach, expect, it, vi } from "vitest";
import { MessageComposer, MessageComposerSend } from "./MessageComposer";

afterEach(cleanup);

it("puts its controls on one bar under the text, with send at the end", () => {
  const attach = vi.fn();
  const onSend = vi.fn();
  render(
    <MessageComposer
      inputProps={{ "aria-label": "Message", value: "", onChange: () => {} }}
      items={[
        { id: "attach", icon: Plus, label: "Attach", priority: 2, onSelect: attach },
        { id: "model", icon: Cpu, label: "A long model name", priority: 1, shrink: true },
      ]}
      end={<MessageComposerSend label="Send" onClick={onSend} />}
    />,
  );
  const bar = screen.getByRole("toolbar", { name: "Message options" });
  fireEvent.click(within(bar).getByRole("button", { name: "Attach" }));
  expect(attach).toHaveBeenCalledTimes(1);
  expect(within(bar).getByRole("button", { name: "A long model name" })).toBeTruthy();
  fireEvent.click(within(bar).getByRole("button", { name: "Send" }));
  expect(onSend).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("textbox", { name: "Message" }).className).toContain("text-body");
  expect(document.querySelector(".flex-wrap")).toBeNull();
});

it("shows where the chat works as a path line under the box", () => {
  const ref = { current: null as HTMLDivElement | null };
  render(
    <MessageComposer
      ref={ref}
      className="w-full"
      inputProps={{ "aria-label": "Message" }}
      end={<MessageComposerSend label="Send" />}
      path={[
        { icon: Layers, label: "Design" },
        { icon: Folder, label: "misty" },
        { icon: GitBranch, label: "main" },
      ]}
    />,
  );
  const path = screen.getByRole("group", { name: "Where this chat works" });
  expect(path.textContent).toBe("Designmistymain");
  // The box keeps the ref and the caller's classes; the line sits outside it.
  expect(ref.current?.getAttribute("data-slot")).toBe("message-composer");
  expect(ref.current?.className).toContain("w-full");
  expect(ref.current?.contains(path)).toBe(false);
});

it("holds the send button while a message is sending", () => {
  const onClick = vi.fn();
  render(<MessageComposerSend label="Send" busy onClick={onClick} />);
  const send = screen.getByRole("button", { name: "Send" });
  expect(send.hasAttribute("disabled")).toBe(true);
  fireEvent.click(send);
  expect(onClick).not.toHaveBeenCalled();
});
