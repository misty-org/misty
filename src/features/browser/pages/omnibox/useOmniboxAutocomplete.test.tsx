import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { browserHistoryChangedEvent } from "../../library/native";
import type { OmniboxInput, OmniboxMatch, OmniboxProvider } from "./omniboxTypes";
import { useOmniboxAutocomplete } from "./useOmniboxAutocomplete";

const input: OmniboxInput = {
  text: "",
  tabId: "t",
  currentUrl: "",
  private: false,
  sessionHistory: [],
};

const page = (id: string): OmniboxMatch => ({
  id,
  kind: "history",
  title: id,
  detail: "",
  target: { type: "navigate", url: `https://${id}.test/` },
  relevance: 1,
  allowedToBeDefault: false,
});

describe("omnibox suggestions", () => {
  it("read history again after it changes, instead of keeping rows that were cleared", async () => {
    let stored = [page("old")];
    const providers: OmniboxProvider[] = [
      { id: "history", start: async () => stored },
    ];
    const { result } = renderHook(() => useOmniboxAutocomplete(input, providers));
    await waitFor(() => expect(result.current.map((match) => match.id)).toEqual(["old"]));
    stored = [];
    act(() => void window.dispatchEvent(new Event(browserHistoryChangedEvent)));
    await waitFor(() => expect(result.current).toEqual([]));
  });
});
