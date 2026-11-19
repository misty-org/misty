import { describe, expect, it } from "vitest";
import { embedAllowance, embedRefusalReason, embedShowsPrivate } from "./embedVisibility";

const me = "user-me";
const other = "user-other";

describe("embedAllowance", () => {
  it("lets a shared item into any host", () => {
    expect(
      embedAllowance({ visibility: "public" }, { visibility: "public", creatorId: other }, me),
    ).toEqual({ ok: true });
    expect(
      embedAllowance(
        { visibility: "private", creatorId: me },
        { visibility: "public", creatorId: other },
        me,
      ),
    ).toEqual({ ok: true });
  });

  it("lets a private item into a private host of the same creator only", () => {
    expect(
      embedAllowance(
        { visibility: "private", creatorId: me },
        { visibility: "private", creatorId: me },
        me,
      ),
    ).toEqual({ ok: true });
    // A private host is its viewer's own when no creator is given.
    expect(
      embedAllowance({ visibility: "private" }, { visibility: "private", creatorId: me }, me),
    ).toEqual({
      ok: true,
    });
    const refused = embedAllowance(
      { visibility: "private", creatorId: other },
      { visibility: "private", creatorId: me },
      me,
    );
    expect(refused).toMatchObject({ ok: false, fix: null });
  });

  it("offers Make shared for the person's own private item in a shared host", () => {
    expect(
      embedAllowance(
        { visibility: "public", creatorId: other },
        { visibility: "private", creatorId: me },
        me,
      ),
    ).toMatchObject({ ok: false, fix: "make-shared" });
  });

  it("offers nothing for someone else's private item in a shared host", () => {
    expect(
      embedAllowance({ visibility: "public" }, { visibility: "private", creatorId: other }, me),
    ).toMatchObject({ ok: false, fix: null });
  });

  it("shows an existing embed whose source turned private as Private in a shared host", () => {
    expect(
      embedShowsPrivate({ visibility: "public" }, { visibility: "private", creatorId: me }, me),
    ).toBe(true);
    expect(
      embedShowsPrivate({ visibility: "private" }, { visibility: "private", creatorId: me }, me),
    ).toBe(false);
  });
});

describe("embedRefusalReason", () => {
  it("refuses an agent's private source in a shared host with the reason, and never offers to share", () => {
    const reason = embedRefusalReason(
      { visibility: "public", creatorId: me },
      { visibility: "private", creatorId: me, title: "Q3" },
    );
    expect(reason).toContain("“Q3” is private");
    expect(reason).toContain("agents don't change an item's visibility");
  });

  it("allows what the rule allows", () => {
    expect(
      embedRefusalReason(
        { visibility: "private", creatorId: me },
        { visibility: "private", creatorId: me },
      ),
    ).toBeNull();
  });
});
