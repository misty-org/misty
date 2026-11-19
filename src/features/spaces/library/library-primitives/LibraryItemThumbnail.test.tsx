import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { SpaceLibraryItem } from "../../api/dto/entities";
import { LibraryItemThumbnail } from "./LibraryItemThumbnail";

afterEach(cleanup);

it("shows a video project as one, not as the text of its file", () => {
  const api = { libraryPreview: vi.fn(), libraryContent: vi.fn() };
  const item = {
    id: "p1",
    display_name: "Trip.mistyvideo",
    version: 1,
    file: {
      original_filename: "Trip.mistyvideo",
      intrinsic_metadata: {
        client_declared_mime_type: "application/vnd.misty.video+json",
        byte_size: 120,
      },
    },
  } as unknown as SpaceLibraryItem;
  const { container } = render(<LibraryItemThumbnail spaceId="s1" item={item} api={api} />);
  expect(container.querySelector("svg.lucide-clapperboard")).not.toBeNull();
  expect(api.libraryContent).not.toHaveBeenCalled();
  expect(api.libraryPreview).not.toHaveBeenCalled();
});
