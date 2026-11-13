import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { writeApiCache } from "./api-cache";
import { setCachedResource, useCachedResource, type CachedResource } from "./cached-resource";

let container: HTMLDivElement;
let root: Root;
let seen: CachedResource<string>[];
let counter = 0;
const freshKey = () => `test/resource:${++counter}`;

function Reader(props: { id: string; load: () => Promise<string>; persist?: "device" | false }) {
  seen.push(useCachedResource(props.id, props.load, { persist: props.persist ?? false }));
  return null;
}

const last = () => seen[seen.length - 1]!;
const settle = () => act(async () => void (await Promise.resolve()));

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  seen = [];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

it("shows a skeleton only on the first load, then the answer", async () => {
  const id = freshKey();
  act(() => root.render(<Reader id={id} load={async () => "fresh"} />));
  expect(last().loading).toBe(true);
  await settle();
  expect(last()).toMatchObject({ data: "fresh", loading: false });
});

it("paints what this session already has, and refreshes behind it", async () => {
  const id = freshKey();
  setCachedResource(id, "earlier");
  let answer!: (value: string) => void;
  act(() =>
    root.render(<Reader id={id} load={() => new Promise<string>((done) => (answer = done))} />),
  );
  expect(last()).toMatchObject({ data: "earlier", loading: false, refreshing: true });
  await act(async () => answer("later"));
  expect(last()).toMatchObject({ data: "later", refreshing: false });
});

it("paints the saved copy from the cache on a new launch", async () => {
  const id = freshKey();
  await writeApiCache("device", `resource:${id}`, JSON.stringify("saved"));
  act(() =>
    root.render(<Reader id={id} persist="device" load={() => new Promise<string>(() => {})} />),
  );
  await settle();
  expect(last()).toMatchObject({ data: "saved", loading: false });
});

it("shares one load between every reader of a key", async () => {
  const id = freshKey();
  const load = vi.fn(async () => "shared");
  act(() =>
    root.render(
      <>
        <Reader id={id} load={load} />
        <Reader id={id} load={load} />
      </>,
    ),
  );
  await settle();
  expect(load).toHaveBeenCalledTimes(1);
});

it("keeps the last answer on screen when a refresh fails", async () => {
  const id = freshKey();
  setCachedResource(id, "kept");
  act(() =>
    root.render(<Reader id={id} load={async () => Promise.reject(new Error("offline"))} />),
  );
  await settle();
  expect(last()).toMatchObject({ data: "kept", loading: false });
  expect(last().error).toBeInstanceOf(Error);
});

it("never lets a read from before a change land over it", async () => {
  const id = freshKey();
  let answer!: (value: string) => void;
  act(() =>
    root.render(<Reader id={id} load={() => new Promise<string>((done) => (answer = done))} />),
  );
  act(() => setCachedResource(id, "changed here"));
  await act(async () => answer("from before"));
  expect(last()).toMatchObject({ data: "changed here", refreshing: false });
});
