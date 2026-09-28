import { afterEach, expect, it } from "vitest";
import { snapshotPage } from "./pageSnapshot";

afterEach(() => {
  document.body.innerHTML = "";
});

it("copies real HTML and styles without scripts, event handlers, or navigation", () => {
  document.body.innerHTML = `<main style="color: rgb(12, 34, 56)"><h1>Actual page heading</h1><a href="javascript:alert(1)" onclick="alert(1)">Read more</a><script>alert(1)</script><img src="https://example.test/photo.png" onerror="alert(1)"><form action="https://example.test"><input type="password" value="secret-password"></form></main>`;
  const result = snapshotPage(document.documentElement)!;
  expect(result.html).toContain("Actual page heading");
  expect(result.html).toContain("rgb(12, 34, 56)");
  expect(result.html).toContain("https://example.test/photo.png");
  expect(result.html).toContain("script-src 'none'");
  expect(result.html).not.toMatch(/<script|onclick|onerror|javascript:|secret-password|action=/);
});

it("keeps each document's own content and removes hidden elements", () => {
  document.body.innerHTML = `<h1>First page</h1><p style="display:none">Hidden content</p>`;
  const first = snapshotPage(document.documentElement)!;
  document.body.innerHTML = `<h1>Second page</h1>`;
  const second = snapshotPage(document.documentElement)!;
  expect(first.html).toContain("First page");
  expect(first.html).not.toContain("Hidden content");
  expect(second.html).toContain("Second page");
  expect(second.html).not.toContain("First page");
});
