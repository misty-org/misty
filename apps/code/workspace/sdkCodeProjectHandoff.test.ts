import { expect, it, vi } from "vitest";
import { createSdkCodeRuntime } from "./sdkCodeRuntime";
import { openSdkCodeProject } from "./sdkCodeProject";
import { createSdkCodeFileFixture } from "./sdkCodeProject.fixture";
import { parseSdkCodeProjectHandoff } from "./sdkCodeProjectHandoff";

it("adopts one project identity into an independent runtime without another folder picker", async () => {
  const first = createSdkCodeFileFixture(),
    second = first.fork();
  const source = createSdkCodeRuntime(first.sdk),
    target = createSdkCodeRuntime(second.sdk);
  try {
    const project = (await source.openProject({ write: false }))!;
    const handoff = await project.share();
    const adopted = (await target.openProject({ handoff }))!;
    expect(adopted.root).toBe(project.root);
    expect(adopted.writable).toBe(false);
    await source.close();
    expect(first.handles.size).toBe(0);
    expect(second.handles.size).toBeGreaterThan(0);
    expect((await adopted.readText(`${adopted.root}/src/${first.file.name}`)).contents).toBe(
      "const value = 1;\n",
    );
    await expect(adopted.create(`${adopted.root}/no.txt`, "file")).rejects.toThrow("read-only");
    expect(
      second.request.mock.calls.some(([message]) => message.method === "files.pickDirectory"),
    ).toBe(false);
    await expect(openSdkCodeProject(second.sdk, { handoff })).rejects.toThrow("Invalid handoff");
  } finally {
    await source.close();
    await target.close();
  }
  expect(second.handles.size).toBe(0);
});

it("cleans a handoff issued after source closure and a grant adopted after target closure", async () => {
  const first = createSdkCodeFileFixture(),
    second = first.fork();
  const source = (await openSdkCodeProject(first.sdk))!;
  const original = first.request.getMockImplementation()!;
  let release!: () => void;
  first.request.mockImplementation(async (message) => {
    const result = await original(message);
    if (message.method === "files.shareDirectory")
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    return result;
  });
  const pending = source.share();
  const rejected = expect(pending).rejects.toThrow("closed");
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  await source.close();
  release();
  await rejected;
  expect(first.shares.size).toBe(0);
  const reopened = (await openSdkCodeProject(first.sdk))!;
  first.request.mockImplementation(original);
  const handoff = await reopened.share();
  const secondOriginal = second.request.getMockImplementation()!;
  let finish!: () => void;
  second.request.mockImplementation(async (message) => {
    const result = await secondOriginal(message);
    if (message.method === "files.adoptDirectory")
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    return result;
  });
  const controller = new AbortController();
  const adopting = openSdkCodeProject(second.sdk, { handoff, signal: controller.signal });
  const late = expect(adopting).rejects.toThrow("closed");
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  controller.abort();
  finish();
  await late;
  expect(second.handles.size).toBe(0);
  await reopened.close();
});

it("rejects malformed or ambient handoff identities before requesting native access", async () => {
  const file = createSdkCodeFileFixture();
  const initial = file.request.mock.calls.length;
  for (const value of [
    { root: "/Users/private", ticket: crypto.randomUUID(), write: true },
    { root: `/misty-project/${crypto.randomUUID()}`, ticket: "native-path", write: true },
    {
      root: `/misty-project/${crypto.randomUUID()}`,
      ticket: crypto.randomUUID(),
      write: true,
      accountId: "foreign",
    },
  ]) {
    expect(() => parseSdkCodeProjectHandoff(value)).toThrow("Invalid");
    await expect(openSdkCodeProject(file.sdk, { handoff: value })).rejects.toThrow("Invalid");
  }
  expect(file.request.mock.calls).toHaveLength(initial);
});
