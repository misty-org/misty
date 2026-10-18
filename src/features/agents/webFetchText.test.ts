// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { billingNote, readablePage } from "./webFetchText";

const page = (body: string) =>
  `<!doctype html><html><head><title> Pricing </title><script>alert(1)</script></head><body>${body}</body></html>`;

describe("readablePage", () => {
  it("keeps the content and drops page chrome", () => {
    const read = readablePage(
      page(
        "<nav><a>Home</a></nav><main><h1>Plans</h1><p>Pro is <b>$10</b> a month.</p><ul><li>Unlimited notes</li></ul>" +
          "<table><tr><th>Plan</th><th>Price</th></tr><tr><td>Team</td><td>$15</td></tr></table></main><footer>© 2026</footer>",
      ),
      "text/html; charset=utf-8",
      "",
    );
    expect(read.title).toBe("Pricing");
    expect(read.text).toBe(
      "# Plans\nPro is $10 a month.\n- Unlimited notes\nPlan | Price\nTeam | $15",
    );
    expect(read.text).not.toMatch(/Home|2026|alert/);
    expect(read.truncated).toBe(false);
  });

  it("keeps prices that sit in plain divs and spans, as pricing pages draw them", () => {
    const read = readablePage(
      page(
        '<div class="toggle"><button>Monthly</button><button>Yearly</button></div>' +
          '<section><div class="card"><h3>Basic</h3><div class="price"><span class="sr-only">$10 per user/month</span>' +
          '<span aria-hidden="true"><i>$</i><i>10</i> per user/month</span></div><div>Billed annually</div></div>' +
          '<div class="card"><h3>Business</h3><div class="price">$16 <span>per user/month</span></div></div></section>' +
          "<nav><div>Docs</div></nav>",
      ),
      "text/html",
      "",
    );
    expect(read.text).toBe(
      "Monthly\nYearly\n### Basic\n$10 per user/month\nBilled annually\n### Business\n$16 per user/month",
    );
  });

  it("uses the whole page when the main area holds only a little of it", () => {
    const read = readablePage(
      page(
        "<main><p>Intro</p></main><div><div>Team</div><div>$12 a month</div></div><div><div>Pro</div><div>$30 a month</div></div>",
      ),
      "text/html",
      "",
    );
    expect(read.text).toContain("$12 a month");
    expect(read.text).toContain("$30 a month");
  });

  it("returns the parts of a long page that match the question", () => {
    const filler = Array.from(
      { length: 400 },
      (_, index) => `<p>Unrelated paragraph number ${index} about the company history.</p>`,
    ).join("");
    const read = readablePage(
      page(
        `<article>${filler}<h2>Pricing</h2><p>The Business plan costs $24 per user per month.</p>${filler}</article>`,
      ),
      "text/html",
      "business plan price per user",
      2_000,
    );
    expect(read.truncated).toBe(true);
    expect(read.text).toContain("The Business plan costs $24 per user per month.");
    expect(read.text.length).toBeLessThanOrEqual(2_000);
  });

  it("passes plain text through", () => {
    expect(readablePage('{"ok":true}', "application/json", "").text).toBe('{"ok":true}');
  });

  it("notes the billing period only when a page has prices and names one", () => {
    expect(billingNote("Plus $10 per seat/month, billed annually")).toMatch(/billing period/);
    expect(billingNote("Plus $10 per seat/month")).toBeUndefined();
    expect(billingNote("Billed monthly or yearly, ask sales")).toBeUndefined();
  });
});
