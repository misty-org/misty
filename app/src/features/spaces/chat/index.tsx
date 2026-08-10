import { lazy, Suspense } from "react";

export {
  buildChatDisplayRows,
  formatChatDateDivider,
  formatChatMessageTime,
} from "./components/ChatDisplay";
export { isInFlightRun, messageReplyPreviewText } from "./components/messageHelpers";
export { useSpaceChatPermissions } from "./hooks/useSpaceChatPermissions";
export * from "./store/useSpaceMessageSpansStore";

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
