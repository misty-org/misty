import { describe, expect, it } from "vitest";
import { loginsToCsv, parseLoginsCsv } from "./csv";
import { generatePassword } from "./generate";

describe("password CSV", () => {
  it("reads a Chrome export with quoted cells", () => {
    const text = 'name,url,username,password\r\nExample,https://example.com,me@x.com,"a,""b"\r\n';
    expect(parseLoginsCsv(text)).toEqual([
      { site: "https://example.com", username: "me@x.com", password: 'a,"b' },
    ]);
  });

  it("round-trips, keeping passwords exact", () => {
    const logins = [{ site: "example.com", username: "=cmd", password: "-pass,word" }];
    const parsed = parseLoginsCsv(loginsToCsv(logins));
    expect(parsed[0].password).toBe("-pass,word");
    expect(parsed[0].username).toBe("'=cmd");
  });

  it("ignores files without url and password columns", () => {
    expect(parseLoginsCsv("a,b\n1,2")).toEqual([]);
  });
});

describe("generatePassword", () => {
  it("has the requested length and every character group", () => {
    const value = generatePassword(20);
    expect(value).toHaveLength(20);
    expect(value).toMatch(/[a-z]/);
    expect(value).toMatch(/[A-Z]/);
    expect(value).toMatch(/[0-9]/);
    expect(value).toMatch(/[^A-Za-z0-9]/);
  });
});
