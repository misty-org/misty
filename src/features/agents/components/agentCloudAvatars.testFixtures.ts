import { vi } from "vitest";

// Interaction tests exercise the real avatar selection and components without
// repeatedly parsing megabytes of image data in JSDOM. The asset contract has
// its own unmocked coverage in agentCloudAvatars.test.ts.
vi.mock("@/shared/assets/agents/cloud-lavender.webp?inline", () => ({
  default: "/test-assets/cloud-lavender.webp",
}));
vi.mock("@/shared/assets/agents/cloud-mint.webp?inline", () => ({
  default: "/test-assets/cloud-mint.webp",
}));
vi.mock("@/shared/assets/agents/cloud-peach.webp?inline", () => ({
  default: "/test-assets/cloud-peach.webp",
}));
vi.mock("@/shared/assets/misty-cloud-expression-cycle.webp?inline", () => ({
  default: "/test-assets/cloud-sky.webp",
}));
vi.mock("@/shared/assets/agents/cloud-lavender-poster.webp?inline", () => ({
  default: "/test-assets/cloud-lavender-poster.webp",
}));
vi.mock("@/shared/assets/agents/cloud-mint-poster.webp?inline", () => ({
  default: "/test-assets/cloud-mint-poster.webp",
}));
vi.mock("@/shared/assets/agents/cloud-peach-poster.webp?inline", () => ({
  default: "/test-assets/cloud-peach-poster.webp",
}));
vi.mock("@/shared/assets/agents/cloud-sky-poster.webp?inline", () => ({
  default: "/test-assets/cloud-sky-poster.webp",
}));
