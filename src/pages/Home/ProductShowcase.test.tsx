import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ProductShowcase from "./ProductShowcase";

const videoStages = [
  {
    id: "files" as const,
    title: "Files",
    description: "Files description",
    media: {
      kind: "video" as const,
      src: "https://cdn.example.com/files.mp4",
      poster: "https://cdn.example.com/files.jpg",
      label: "Files",
    },
  },
  {
    id: "space" as const,
    title: "Space",
    description: "Space description",
    media: {
      kind: "video" as const,
      src: "https://cdn.example.com/space.mp4",
      label: "Space",
    },
  },
];

describe("ProductShowcase video media", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  it("autoplays muted inline video, loops it, and pauses it after a tab change", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <ProductShowcase stages={videoStages} />
      </MemoryRouter>,
    );

    const filesVideo = screen.getByLabelText("Files demo video") as HTMLVideoElement;
    expect(filesVideo.autoplay).toBe(true);
    expect(filesVideo.loop).toBe(true);
    expect(filesVideo.muted).toBe(true);
    expect(filesVideo.playsInline).toBe(true);
    expect(filesVideo.controls).toBe(false);
    await waitFor(() => expect(play).toHaveBeenCalled());

    await user.click(screen.getByRole("tab", { name: "Space" }));

    await waitFor(() => expect(screen.getByLabelText("Space demo video")).toBeInTheDocument());
    expect(pause).toHaveBeenCalled();
    expect(play).toHaveBeenCalledTimes(2);
  });

  it("falls back from a failed video to its poster and then to a placeholder", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});

    render(
      <MemoryRouter>
        <ProductShowcase stages={videoStages} />
      </MemoryRouter>,
    );

    fireEvent.error(screen.getByLabelText("Files demo video"));
    const poster = await screen.findByRole("img", { name: "Files demo preview" });
    expect(poster).toHaveAttribute("src", "https://cdn.example.com/files.jpg");

    fireEvent.error(poster);
    expect(await screen.findByRole("img", { name: "Files demo placeholder" })).toBeInTheDocument();
  });
});
