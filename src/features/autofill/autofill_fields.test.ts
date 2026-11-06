import { describe, expect, it } from "vitest";
import source from "../../../src-tauri/src/infra/browser/scripts/autofill_fields.js?raw";

type Meta = Partial<Record<"tag" | "type" | "autocomplete" | "name" | "id" | "label" | "placeholder" | "ariaLabel", string>> & {
  maxLength?: number;
};
type Fields = {
  classifyField(meta: Meta): string | null;
  sectionOf(autocomplete: string): string;
  kindOf(type: string): string;
  formIsFor(kind: string, types: string[]): boolean;
  planFill(fields: { type: string; section: string }[], focus: number): number[];
  valueFor(type: string, values: Record<string, unknown>, meta: Meta): string;
  matchOption(type: string, value: string, options: { value: string; text: string }[]): number;
  readForm(entries: [string, string][]): {
    address?: Record<string, string>;
    card?: { number: string; holder: string; expMonth: number; expYear: number };
  };
};

// The same file the page runs, loaded as it ships.
const fields = new Function(`${source}; return autofillFields;`)() as Fields;

describe("classifyField", () => {
  it("trusts autocomplete first, with its section words", () => {
    expect(fields.classifyField({ autocomplete: "shipping street-address" })).toBe("street");
    expect(fields.classifyField({ autocomplete: "section-a billing postal-code" })).toBe("postal-code");
    expect(fields.classifyField({ autocomplete: "cc-number", name: "nonsense" })).toBe("cc-number");
  });

  it.each([
    [{ name: "firstName" }, "given-name"],
    [{ id: "last_name" }, "family-name"],
    [{ label: "Full name" }, "name"],
    [{ name: "address1" }, "line1"],
    [{ label: "Apartment, suite, etc." }, "line2"],
    [{ placeholder: "Street address" }, "street"],
    [{ name: "zip" }, "postal-code"],
    [{ label: "Postcode" }, "postal-code"],
    [{ name: "city" }, "city"],
    [{ label: "State / Province" }, "region"],
    [{ tag: "select", name: "country" }, "country"],
    [{ label: "Phone number" }, "tel"],
    [{ type: "email", label: "Email address" }, "email"],
    [{ label: "Company" }, "organization"],
    [{ label: "Card number" }, "cc-number"],
    [{ name: "cardNumber" }, "cc-number"],
    [{ label: "Name on card" }, "cc-name"],
    [{ label: "Expiry date", placeholder: "MM / YY" }, "cc-exp"],
    [{ name: "exp-month" }, "cc-exp-month"],
    [{ name: "expiration_year" }, "cc-exp-year"],
  ] as [Meta, string][])("reads %j as %s", (meta, type) => {
    expect(fields.classifyField(meta)).toBe(type);
  });

  it("an email address isn't a street address", () => {
    expect(fields.classifyField({ label: "Email address" })).toBe("email");
  });

  it.each([
    [{ label: "Security code" }],
    [{ name: "cvv" }],
    [{ autocomplete: "cc-csc" }],
    [{ name: "cvc", label: "Card code" }],
    [{ autocomplete: "one-time-code" }],
    [{ type: "password", name: "address" }],
    [{ type: "hidden", name: "address" }],
    [{ type: "checkbox", name: "state" }],
    [{ label: "Username" }],
    [{ label: "Promo code" }],
    [{ label: "Search for a city" }],
    [{ label: "Social security number" }],
    [{ label: "Message" }],
  ] as [Meta][])("never fills %j", (meta) => {
    expect(fields.classifyField(meta)).toBeNull();
  });
});

describe("formIsFor", () => {
  it("wants a street and a place for an address", () => {
    expect(fields.formIsFor("address", ["name", "street", "city", "postal-code"])).toBe(true);
    expect(fields.formIsFor("address", ["line1", "postal-code"])).toBe(true);
  });

  it("doesn't take a contact form or newsletter box for an address", () => {
    expect(fields.formIsFor("address", ["email"])).toBe(false);
    expect(fields.formIsFor("address", ["name", "email"])).toBe(false);
    expect(fields.formIsFor("address", ["name", "email", "tel"])).toBe(false);
  });

  it("wants a card number for a card", () => {
    expect(fields.formIsFor("card", ["cc-number", "cc-exp"])).toBe(true);
    expect(fields.formIsFor("card", ["cc-exp", "cc-name"])).toBe(false);
  });
});

describe("planFill", () => {
  const field = (type: string, section = "") => ({ type, section });

  it("fills each type once, from the field the person is in", () => {
    const form = [field("name"), field("street"), field("city"), field("name"), field("street")];
    expect(fields.planFill(form, 3)).toEqual([2, 3, 4]);
  });

  it("stays in the person's section of a form with two addresses", () => {
    const form = [
      field("street", "shipping"),
      field("city", "shipping"),
      field("street", "billing"),
      field("city", "billing"),
    ];
    expect(fields.planFill(form, 2)).toEqual([2, 3]);
  });

  it("never mixes a card into an address fill or the reverse", () => {
    const form = [field("street"), field("cc-number"), field("city"), field("cc-exp")];
    expect(fields.planFill(form, 0)).toEqual([0, 2]);
    expect(fields.planFill(form, 1)).toEqual([1, 3]);
  });
});

describe("valueFor", () => {
  const address = {
    name: "Ada King Lovelace",
    street: "1 Main St\nApt 2\nRear",
    phone: "555 0100",
    postalCode: "12345",
  };
  const card = { number: "4242424242424242", holder: "Ada", expMonth: 3, expYear: 2031 };

  it("splits a name at its last word", () => {
    expect(fields.valueFor("given-name", address, {})).toBe("Ada King");
    expect(fields.valueFor("family-name", address, {})).toBe("Lovelace");
    expect(fields.valueFor("family-name", { name: "Ada" }, {})).toBe("");
  });

  it("writes streets to suit the field", () => {
    expect(fields.valueFor("line1", address, {})).toBe("1 Main St");
    expect(fields.valueFor("line2", address, {})).toBe("Apt 2, Rear");
    expect(fields.valueFor("street", address, { tag: "INPUT" })).toBe("1 Main St, Apt 2, Rear");
    expect(fields.valueFor("street", address, { tag: "TEXTAREA" })).toBe("1 Main St\nApt 2\nRear");
  });

  it.each([
    [{}, "03/31"],
    [{ placeholder: "MM/YY" }, "03/31"],
    [{ placeholder: "MM-YY" }, "03-31"],
    [{ placeholder: "MM/YYYY" }, "03/2031"],
    [{ maxLength: 4 }, "0331"],
    [{ maxLength: 7 }, "03/2031"],
  ] as [Meta, string][])("writes an expiry field %j as %s", (meta, value) => {
    expect(fields.valueFor("cc-exp", card, meta)).toBe(value);
  });

  it("writes separate month and year fields", () => {
    expect(fields.valueFor("cc-exp-month", card, {})).toBe("03");
    expect(fields.valueFor("cc-exp-year", card, {})).toBe("2031");
    expect(fields.valueFor("cc-exp-year", card, { maxLength: 2 })).toBe("31");
    expect(fields.valueFor("cc-exp-year", card, { placeholder: "YY" })).toBe("31");
  });
});

describe("matchOption", () => {
  const options = (...pairs: [string, string][]) => pairs.map(([value, text]) => ({ value, text }));

  it("matches a state by name or abbreviation, either way round", () => {
    const states = options(["", "Select"], ["CA", "California"], ["NY", "New York"]);
    expect(fields.matchOption("region", "California", states)).toBe(1);
    expect(fields.matchOption("region", "ny", states)).toBe(2);
    const named = options(["California", "California"], ["New York", "New York"]);
    expect(fields.matchOption("region", "CA", named)).toBe(0);
    expect(fields.matchOption("region", "TX", states)).toBe(-1);
  });

  it("matches a country through its common names", () => {
    const countries = options(["CA", "Canada"], ["US", "United States"], ["GB", "United Kingdom"]);
    expect(fields.matchOption("country", "USA", countries)).toBe(1);
    expect(fields.matchOption("country", "United States of America", countries)).toBe(1);
    expect(fields.matchOption("country", "UK", countries)).toBe(2);
  });

  it("matches months and years however the form writes them", () => {
    const numbers = options(["1", "01"], ["2", "02"], ["3", "03"]);
    const names = options(["jan", "January"], ["feb", "February"], ["mar", "March"]);
    expect(fields.matchOption("cc-exp-month", "03", numbers)).toBe(2);
    expect(fields.matchOption("cc-exp-month", "03", names)).toBe(2);
    const years = options(["", "Year"], ["2030", "2030"], ["31", "2031"]);
    expect(fields.matchOption("cc-exp-year", "2031", years)).toBe(2);
    expect(fields.matchOption("cc-exp-year", "2040", years)).toBe(-1);
  });
});

describe("readForm", () => {
  it("reads an address, joining split names and streets", () => {
    const { address, card } = fields.readForm([
      ["given-name", "Ada"],
      ["family-name", "Lovelace"],
      ["line1", "1 Main St"],
      ["line2", "Apt 2"],
      ["city", "Springfield"],
      ["postal-code", "12345"],
    ]);
    expect(address).toMatchObject({
      name: "Ada Lovelace",
      street: "1 Main St\nApt 2",
      postalCode: "12345",
    });
    expect(card).toBeUndefined();
  });

  it("reads nothing from a form that's neither", () => {
    expect(fields.readForm([["name", "Ada"], ["email", "ada@example.com"]])).toEqual({});
  });

  it.each([
    [[["cc-exp", "12/31"]], 12, 31],
    [[["cc-exp", "12 / 2031"]], 12, 2031],
    [[["cc-exp", "1231"]], 12, 31],
    [[["cc-exp-month", "March"], ["cc-exp-year", "2031"]], 3, 2031],
    [[["cc-exp-month", "03"], ["cc-exp-year", "31"]], 3, 31],
  ] as [[string, string][], number, number][])("reads the expiry from %j", (entries, month, year) => {
    const { card } = fields.readForm([["cc-number", "4242424242424242"], ...entries]);
    expect(card).toMatchObject({ expMonth: month, expYear: year });
  });

  it("has no place for a security code", () => {
    const { card } = fields.readForm([["cc-number", "4242424242424242"], ["cc-exp", "12/31"]]);
    expect(Object.keys(card ?? {}).sort()).toEqual(["expMonth", "expYear", "holder", "number"]);
  });
});
