import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { SpaceSectionView } from "./SpaceSectionView";
const state = vi.hoisted(() => ({
  spaces: [{ id: "family", name: "Family", role: "member" }],
  snapshotReady: true,
  loading: false,
  error: null,
  load: vi.fn(),
  loadSpace: vi.fn(),
}));
vi.mock("@/features/account", () => ({
  useAuth: () => ({ user: { id: "one" }, accounts: [], transitioning: false }),
}));
vi.mock("../list/useSpacesStore", () => ({
  useSpacesStore: (selector: (value: typeof state) => unknown) => selector(state),
}));
// Files is the same page in every Space, so it takes no Space of its own.
vi.mock("../file-manager/FilesPage", () => ({
  FilesPage: () => <div>Files in family</div>,
}));
vi.mock("../chat/SpaceChatEntry", () => ({
  SpaceChatEntry: ({ spaceId }: { spaceId: string }) => <div>Chat in {spaceId}</div>,
}));
afterEach(() => {
  cleanup();
});
// A Space's own address, and its old settings links, open its chat; Files opens its own page.
it.each([
  ["home", "Chat"],
  ["settings", "Chat"],
  ["chat", "Chat"],
  ["files", "Files"],
  ["social", "Chat"],
])("opens %s as %s directly without an installed app", async (section, label) => {
  render(
    <MemoryRouter
      initialEntries={[`/spaces/family/${section === "social" ? "social/misty" : section}`]}
    >
      <SpaceSectionView spaceId="family" section={section} />
    </MemoryRouter>,
  );
  expect(
    await screen.findByText(new RegExp(`${label} in family`), {}, { timeout: 5000 }),
  ).toBeTruthy();
});

it("says a removed view isn't available", async () => {
  render(
    <MemoryRouter initialEntries={["/spaces/family/notes"]}>
      <SpaceSectionView spaceId="family" section="notes" />
    </MemoryRouter>,
  );
  expect(await screen.findByText("This Space view isn’t available")).toBeTruthy();
});
