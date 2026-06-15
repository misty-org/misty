import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  EmailBody,
  estimateEmailHeight,
  linkifyEmailContent,
  measureDocumentHeight,
  prefetchEmailHtml,
  prefetchThreadHtml,
} from "./EmailBody";

describe("EmailBody", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.innerHTML = "";
  });

  describe("linkifyEmailContent", () => {
    it("converts plain URLs to markdown links", () => {
      expect(linkifyEmailContent("Check https://example.com/test now")).toBe(
        "Check [https://example.com/test](https://example.com/test) now",
      );
    });

    it("does not double linkify existing markdown links", () => {
      expect(linkifyEmailContent("[Click here](https://example.com)")).toBe(
        "[Click here](https://example.com)",
      );
    });

    it("handles URLs in parentheses", () => {
      expect(linkifyEmailContent("( https://example.com/test )")).toBe(
        "( [https://example.com/test](https://example.com/test) )",
      );
    });
  });

  describe("estimateEmailHeight and measureDocumentHeight", () => {
    it("estimates realistic height for empty or minimal HTML", () => {
      expect(estimateEmailHeight("")).toBe(200);
      expect(estimateEmailHeight("<p>Short</p>")).toBeGreaterThanOrEqual(120);
    });

    it("scales height based on images, paragraphs, and headings", () => {
      const small = estimateEmailHeight("<p>Hello</p>");
      const large = estimateEmailHeight(
        "<h1>Welcome</h1><img src='banner.png' height='300'/><p>One</p><p>Two</p><p>Three</p>",
      );
      expect(large).toBeGreaterThan(small + 300);
    });

    it("accurately bounds document height without adding trailing white space", () => {
      const parser = new DOMParser();
      const doc = parser.parseFromString(
        `<!DOCTYPE html><html><body><div style="height: 150px;">Content</div></body></html>`,
        "text/html",
      );
      const measured = measureDocumentHeight(doc);
      expect(measured).toBeGreaterThanOrEqual(80);
      expect(measured).toBeLessThan(500);
    });
  });

  describe("prefetchEmailHtml & prefetchThreadHtml", () => {
    it("safely warms up document cache and height cache without throwing", () => {
      expect(() => {
        prefetchEmailHtml("<div><p>Prefetched content</p></div>");
      }).not.toThrow();

      expect(() => {
        prefetchThreadHtml({
          connectionId: "c1",
          key: "c1:t1",
          provider: "gmail",
          provider_id: "t1",
          account_id: "a1",
          subject: "Test",
          snippet: "Test snippet",
          participants: [],
          labels: [],
          last_message_at: "2026-08-20T00:00:00Z",
          unread: false,
          starred: false,
          messages: [
            {
              provider: "gmail",
              provider_id: "m1",
              account_id: "a1",
              thread_id: "t1",
              subject: "Test",
              from: { email: "sender@example.com" },
              to: [],
              cc: [],
              bcc: [],
              reply_to: [],
              sent_at: "2026-08-20T00:00:00Z",
              snippet: "Snippet",
              body: { text: "Hi", html: "<p>Hi</p>", had_html: true, truncated: false },
              labels: [],
              unread: false,
              starred: false,
              draft: false,
              attachments: [],
            },
          ],
        });
      }).not.toThrow();
    });
  });

  describe("Rendering", () => {
    it("renders HTML iframe when html is present", async () => {
      await act(async () => {
        root.render(
          <EmailBody
            body={{
              text: "Plain fallback",
              html: "<p>Rich <b>email</b> content</p>",
              had_html: true,
              truncated: false,
            }}
          />,
        );
      });

      const iframe = document.querySelector("iframe");
      expect(iframe).not.toBeNull();
      expect(iframe?.getAttribute("srcdoc")).toContain("Rich <b>email</b> content");
      expect(iframe?.getAttribute("srcdoc")).toContain("default-src 'none'");
      expect(iframe?.getAttribute("sandbox")).toBe("allow-same-origin");
      expect(iframe?.getAttribute("referrerpolicy")).toBe("no-referrer");
    });

    it("does not substitute another email when short cache hashes collide", async () => {
      // Aa and BB collide under the existing 31-based height-cache hash.
      for (const content of ["Aa", "BB"]) {
        await act(async () =>
          root.render(
            <EmailBody
              body={{ text: "", html: `<p>${content}</p>`, had_html: true, truncated: false }}
            />,
          ),
        );
        const source = container.querySelector("iframe")?.getAttribute("srcdoc");
        expect(source).toContain(`<p>${content}</p>`);
        expect(source).not.toContain(`<p>${content === "Aa" ? "BB" : "Aa"}</p>`);
      }
    });

    it("renders markdown when only text is present", async () => {
      await act(async () => {
        root.render(
          <EmailBody
            body={{
              text: "# Hello\n\nThis is a *test* email.",
              had_html: false,
              truncated: false,
            }}
          />,
        );
      });

      expect(document.querySelector("iframe")).toBeNull();
      expect(document.querySelector("h1")?.textContent).toBe("Hello");
      expect(document.querySelector("em")?.textContent).toBe("test");
    });
  });
});
