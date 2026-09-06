import { afterEach, expect, it, vi } from "vitest";
import { fetchAppRuntimeResource } from "./runtimeResource";

afterEach(() => vi.restoreAllMocks());

it("downloads a signed resource without forwarding the app token or cookies", async () => {
  const abort = new AbortController();
  const request = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ url: "https://storage.example.com/file?signature=test" }), {
        headers: { "X-Misty-Signed-Download": "1" },
      }),
    )
    .mockResolvedValueOnce(
      new Response("resource", { headers: { "Set-Cookie": "private=value" } }),
    );
  const result = await fetchAppRuntimeResource(new URL("https://api.example.com/v1/file"), {
    headers: { Authorization: "Bearer app-token" },
    signal: abort.signal,
  });
  expect(request.mock.calls[1]?.[1]).toEqual({
    credentials: "omit",
    redirect: "error",
    signal: abort.signal,
  });
  expect(result.headers.some(([name]) => name === "set-cookie")).toBe(false);
  expect(new TextDecoder().decode(result.body)).toBe("resource");
});

it.each(["http://storage.example.com/file", "https://user:password@storage.example.com/file"])(
  "refuses unsafe signed download %s",
  async (url) => {
    const request = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ url }), {
        headers: { "X-Misty-Signed-Download": "1" },
      }),
    );
    await expect(
      fetchAppRuntimeResource(new URL("https://api.example.com/v1/file"), {}),
    ).rejects.toThrow("invalid download URL");
    expect(request).toHaveBeenCalledOnce();
  },
);
