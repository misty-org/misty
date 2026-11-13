import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Field } from "./Field";
import { SecretField } from "./SecretField";

afterEach(cleanup);

/** Holds `saved` the way a settings row does, flipping it as the keychain answers. */
function Harness(props: {
  initial: boolean;
  save?: (value: string) => Promise<void>;
  remove?: () => Promise<void>;
}) {
  const [saved, setSaved] = useState(props.initial);
  return (
    <SecretField
      label="OpenAI key"
      saved={saved}
      onSave={async (value) => {
        await props.save?.(value);
        setSaved(true);
      }}
      onRemove={async () => {
        await props.remove?.();
        setSaved(false);
      }}
    />
  );
}

async function openMenu() {
  fireEvent.keyDown(screen.getByRole("button", { name: "OpenAI key actions" }), { key: "Enter" });
  return screen.findByRole("menu", { name: "OpenAI key actions" });
}

describe("SecretField", () => {
  it("saves a pasted key on Enter and then only says it is saved", async () => {
    const save = vi.fn(async () => {});
    const { container } = render(<Harness initial={false} save={save} />);
    const input = screen.getByLabelText("OpenAI key") as HTMLInputElement;
    expect(input.type).toBe("password");
    expect(input.placeholder).toBe("Paste a key");
    fireEvent.change(input, { target: { value: "  sk-secret  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    await screen.findByText("Saved in keychain");
    expect(save).toHaveBeenCalledWith("sk-secret");
    expect(container.textContent).not.toContain("sk-secret");
    expect(container.querySelector("input")).toBeNull();
    expect(screen.getByRole("button", { name: "OpenAI key actions" })).toBeTruthy();
  });

  it("saves when focus leaves the field, and ignores an empty one", async () => {
    const save = vi.fn(async () => {});
    render(
      <>
        <Harness initial={false} save={save} />
        <button type="button">Next</button>
      </>,
    );
    const input = screen.getByLabelText("OpenAI key");
    fireEvent.blur(input, { relatedTarget: screen.getByRole("button", { name: "Next" }) });
    expect(save).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "sk-1" } });
    fireEvent.blur(input, { relatedTarget: screen.getByRole("button", { name: "Next" }) });
    await screen.findByText("Saved in keychain");
    expect(save).toHaveBeenCalledOnce();
  });

  it("shows a failed save under the field and keeps the typed value to fix", async () => {
    render(
      <Harness
        initial={false}
        save={async () => {
          throw new Error("The keychain is locked.");
        }}
      />,
    );
    const input = screen.getByLabelText("OpenAI key") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "sk-1" } });
    fireEvent.keyDown(input, { key: "Enter" });
    const error = await screen.findByText("The keychain is locked.");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toContain(error.id);
    expect(input.value).toBe("sk-1");
    fireEvent.change(input, { target: { value: "sk-2" } });
    expect(screen.queryByText("The keychain is locked.")).toBeNull();
  });

  it("replaces a key from its ⋯ menu, focused, and Escape goes back", async () => {
    render(<Harness initial />);
    fireEvent.click(await within(await openMenu(), "Replace key"));
    const input = (await screen.findByLabelText("OpenAI key")) as HTMLInputElement;
    expect(input.placeholder).toBe("Paste the new key");
    expect(input.value).toBe("");
    await waitFor(() => expect(document.activeElement).toBe(input));
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.getByText("Saved in keychain")).toBeTruthy();
  });

  it("asks before removing and goes back to the empty field", async () => {
    const remove = vi.fn(async () => {});
    render(<Harness initial remove={remove} />);
    fireEvent.click(await within(await openMenu(), "Remove key"));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("Remove the OpenAI key?");
    expect(remove).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    });
    expect(remove).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(screen.getByLabelText("OpenAI key")).toBeTruthy();
  });

  it("marks the remove item as danger", async () => {
    render(<Harness initial />);
    const menu = await openMenu();
    const item = await within(menu, "Remove key");
    expect(item.className).toContain("text-danger");
  });

  it("shows a skeleton the same size while the keychain is read", () => {
    render(<SecretField label="OpenAI key" saved={null} onSave={() => {}} onRemove={() => {}} />);
    const skeleton = screen.getByRole("status", { name: "OpenAI key" });
    expect(skeleton.className).toContain("h-8");
  });

  it("shows an owner's error and takes its id from Field", () => {
    render(
      <Field label="OpenAI">
        <SecretField
          label="OpenAI key"
          saved={false}
          error="That key was rejected."
          onSave={() => {}}
          onRemove={() => {}}
        />
      </Field>,
    );
    const input = screen.getByLabelText("OpenAI key");
    expect(document.querySelector("label")?.getAttribute("for")).toBe(input.id);
    expect(screen.getByText("That key was rejected.").id).toBeTruthy();
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });
});

/** A menu row by its name inside an open menu. */
async function within(menu: HTMLElement, name: string) {
  await waitFor(() => expect(menu.querySelector('[role="menuitem"]')).not.toBeNull());
  const item = Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((row) =>
    row.textContent?.includes(name),
  );
  if (!item) throw new Error(`No menu item ${name}`);
  return item;
}
