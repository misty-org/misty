import { expect, it } from "vitest";
import { browserAddress } from "./browserAddress";

it("keeps web addresses, completes bare names and searches the rest", () => {
  expect(browserAddress("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
  expect(browserAddress("example.com")).toBe("https://example.com/");
  expect(browserAddress("youtube.com/@ThePrimeTimeagen")).toBe(
    "https://youtube.com/@ThePrimeTimeagen",
  );
  expect(browserAddress("localhost:5173")).toBe("http://localhost:5173/");
  expect(browserAddress("new primeagen videos")).toBe(
    "https://duckduckgo.com/?q=new%20primeagen%20videos",
  );
  expect(browserAddress("  ")).toBeNull();
  expect(browserAddress("javascript:alert(1)")).toBe(
    "https://duckduckgo.com/?q=javascript%3Aalert(1)",
  );
});
