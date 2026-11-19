import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const wasmBytes = () => readFileSync(require.resolve("opencut-wasm/opencut_wasm_bg.wasm"));

afterEach(cleanup);

describe("OpenCut's core in Misty", () => {
  it("loads once from the package's own module and answers with its bindings", async () => {
    const { loadOpencutWasm, formatTimecode, mediaTimeFromSeconds, TICKS_PER_SECOND } =
      await import("@opencut/wasm/load");
    await loadOpencutWasm(wasmBytes());
    await loadOpencutWasm(wasmBytes());
    expect(TICKS_PER_SECOND()).toBe(120000);
    const time = mediaTimeFromSeconds({ seconds: 75.5 });
    expect(
      formatTimecode({
        time: time!,
        format: "HH:MM:SS:FF",
        rate: { numerator: 30, denominator: 1 },
      }),
    ).toBe("00:01:15:15");
  });

  it("then lets the editor's modules that read it as they load be imported", async () => {
    const { loadOpencutWasm } = await import("@opencut/wasm/load");
    await loadOpencutWasm(wasmBytes());
    const { ZERO_MEDIA_TIME, TICKS_PER_SECOND } = await import("@opencut/wasm");
    const { DEFAULT_NEW_ELEMENT_DURATION } = await import("@opencut/timeline/creation");
    expect(ZERO_MEDIA_TIME).toBe(0);
    expect(TICKS_PER_SECOND).toBe(120000);
    expect(DEFAULT_NEW_ELEMENT_DURATION).toBeGreaterThan(0);
  });
});

describe("OpenCut's notices are Misty's", () => {
  it("joins a description to its message and marks errors", async () => {
    const notices = await import("@/shared/ui");
    const notify = vi.spyOn(notices, "notify");
    const { toast } = await import("@opencut/components/toast");
    toast.error("Export failed", { description: "Disk full" });
    toast.success("Saved");
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Export failed — Disk full", tone: "error" }),
    );
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ message: "Saved" }));
  });
});

describe("captions come from the computer's own speech recognition", () => {
  it("can't transcribe until a transcriber is set, then uses it", async () => {
    const service = await import("@opencut/services/transcription/service");
    service.setTranscriber(null);
    expect(service.canTranscribe()).toBe(false);
    await expect(
      service.transcriptionService.transcribe({ audioBlob: new Blob(["x"]) }),
    ).rejects.toThrow("Speech recognition isn't available on this computer.");
    const transcriber = vi.fn(async () => ({
      text: "hello",
      segments: [{ text: "hello", start: 0, end: 0.5 }],
      language: "en",
    }));
    service.setTranscriber(transcriber);
    expect(service.canTranscribe()).toBe(true);
    const result = await service.transcriptionService.transcribe({
      audioBlob: new Blob(["x"]),
      language: "auto",
    });
    expect(result.segments).toHaveLength(1);
    expect(transcriber).toHaveBeenCalledWith(expect.objectContaining({ language: undefined }));
    service.setTranscriber(null);
  });
});

describe("OpenCut's controls are drawn by Misty's", () => {
  it("reads a tooltip's words out of its parts", async () => {
    const { Tooltip, TooltipContent, TooltipTrigger } =
      await import("@opencut/components/ui/tooltip");
    const { TooltipProvider } = await import("@/shared/ui");
    render(
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button">Split</button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Split element</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );
    expect(screen.getByRole("button", { name: "Split" })).toBeTruthy();
  });

  it("gives an icon-only button its label as its name", async () => {
    const { Button } = await import("@opencut/components/ui/button");
    const { TooltipProvider } = await import("@/shared/ui");
    render(
      <TooltipProvider>
        <Button size="icon" variant="ghost" aria-label="Delete element">
          <svg />
        </Button>
        <Button variant="destructive">Delete</Button>
      </TooltipProvider>,
    );
    expect(screen.getByRole("button", { name: "Delete element" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete" }).getAttribute("data-variant")).toBe(
      "danger",
    );
  });
});
