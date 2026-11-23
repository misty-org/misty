import { vi } from "vitest";

vi.mock("@/shared/assets/agents/cloud-lavender.webp", () => ({
  default: "/test-assets/cloud-lavender.webp",
}));
vi.mock("@/shared/assets/agents/cloud-mint.webp", () => ({
  default: "/test-assets/cloud-mint.webp",
}));
vi.mock("@/shared/assets/agents/cloud-peach.webp", () => ({
  default: "/test-assets/cloud-peach.webp",
}));
vi.mock("@/shared/assets/misty-cloud-expression-cycle.webp", () => ({
  default: "/test-assets/cloud-sky.webp",
}));
vi.mock("@/shared/assets/agents/cloud-lavender-poster.webp", () => ({
  default: "/test-assets/cloud-lavender-poster.webp",
}));
vi.mock("@/shared/assets/agents/cloud-mint-poster.webp", () => ({
  default: "/test-assets/cloud-mint-poster.webp",
}));
vi.mock("@/shared/assets/agents/cloud-peach-poster.webp", () => ({
  default: "/test-assets/cloud-peach-poster.webp",
}));
vi.mock("@/shared/assets/agents/cloud-sky-poster.webp", () => ({
  default: "/test-assets/cloud-sky-poster.webp",
}));
