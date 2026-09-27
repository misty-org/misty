import { afterEach, describe, expect, it } from "vitest";
import { insertIntoFocusedField } from "./insertText";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("insertIntoFocusedField", () => {
  it("inserts at the caret with a space, and fires input", () => {
    const input = document.createElement("input");
    input.value = "Hello there";
    document.body.append(input);
    input.focus();
    input.setSelectionRange(5, 5);
    let fired = "";
    input.addEventListener("input", (event) => (fired = (event as InputEvent).data ?? ""));
    expect(insertIntoFocusedField("again")).toBe(true);
    expect(input.value).toBe("Hello again there");
    expect(fired).toBe(" again");
    expect(input.selectionStart).toBe(11);
  });

  it("never types into passwords, read-only fields or nothing", () => {
    const password = document.createElement("input");
    password.type = "password";
    document.body.append(password);
    password.focus();
    expect(insertIntoFocusedField("secret")).toBe(false);
    const readonly = document.createElement("textarea");
    readonly.readOnly = true;
    document.body.append(readonly);
    readonly.focus();
    expect(insertIntoFocusedField("x")).toBe(false);
    readonly.blur();
    expect(insertIntoFocusedField("x")).toBe(false);
  });
});
