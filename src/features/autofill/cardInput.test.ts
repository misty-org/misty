import { describe, expect, it } from "vitest";
import { formatCardExpiry, formatCardNumber, parseCardExpiry } from "./cardInput";

describe("formatCardNumber", () => {
  it("groups digits in fours and drops everything else", () => {
    expect(formatCardNumber("4242424242424242")).toBe("4242 4242 4242 4242");
    expect(formatCardNumber("4242-4242 42x")).toBe("4242 4242 42");
    expect(formatCardNumber("")).toBe("");
  });

  it("stops at the longest card number there is", () => {
    expect(formatCardNumber("1".repeat(30)).replace(/ /g, "")).toHaveLength(19);
  });
});

describe("parseCardExpiry", () => {
  it.each([
    ["12/31", 12, 2031],
    ["3/31", 3, 2031],
    ["03 / 2031", 3, 2031],
    ["0331", 3, 2031],
    ["03-31", 3, 2031],
  ])("reads %s", (text, month, year) => {
    expect(parseCardExpiry(text)).toEqual({ month, year });
  });

  it.each(["", "13/31", "00/31", "12", "12/3", "soon"])("refuses %j", (text) => {
    expect(parseCardExpiry(text)).toBeNull();
  });
});

describe("formatCardExpiry", () => {
  it("writes a short month and year", () => {
    expect(formatCardExpiry(3, 2031)).toBe("03/31");
  });
});
