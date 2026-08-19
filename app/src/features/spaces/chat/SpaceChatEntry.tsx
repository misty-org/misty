import { lazy, Suspense } from "react";

const SpaceChatImplementation = lazy(() =>
  import("./SpaceChat").then((module) => ({ default: module.SpaceChat })),
);

export function SpaceChat(props: { spaceId: string }) {
  return (
    <Suspense fallback={null}>
      <SpaceChatImplementation {...props} />
    </Suspense>
  );
}
