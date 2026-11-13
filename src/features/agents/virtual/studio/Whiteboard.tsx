import { Html } from "@react-three/drei";
import { Check, Loader, X } from "lucide-react";
import { OverflowFadeText, Text, type ArtColor } from "@/shared/ui";
import type { BoardRow } from "../studioTalk";
import { Box, Cyl } from "./parts";

/** Marker colors for where each part stands: blue at work, green done, red failed. */
const rowArt: Record<BoardRow["state"], ArtColor | undefined> = {
  working: undefined,
  done: "green-ink",
  failed: "red-ink",
};

/**
 * The meeting room's whiteboard, put up behind the table while several agents share a task: the
 * task written across the top, and each agent's name with where its part stands. The writing is
 * page text laid onto the board, so it stays sharp at any distance.
 */
export function Whiteboard(props: {
  at: { x: number; z: number };
  task: string;
  rows: BoardRow[];
  names: Map<string, string>;
}) {
  const { at } = props;
  return (
    <group position={[at.x, 0, at.z - 1.55]}>
      {[-0.78, 0.78].map((x) => (
        <group key={x}>
          <Cyl r={0.025} h={1.6} at={[x, 0.8, 0]} color="#8a8f99" shadow={false} />
          <Box size={[0.32, 0.03, 0.06]} at={[x, 0.015, 0]} color="#8a8f99" shadow={false} />
        </group>
      ))}
      <Box size={[1.7, 1.02, 0.05]} at={[0, 1.18, 0]} color="#c9ced6" round={0.02} />
      <Box size={[1.6, 0.92, 0.012]} at={[0, 1.18, 0.03]} color="#fbfbf8" shadow={false} />
      <Box size={[1.1, 0.04, 0.08]} at={[0, 0.66, 0.05]} color="#b8bec8" shadow={false} />
      <Html
        transform
        position={[0, 1.18, 0.04]}
        distanceFactor={1.15}
        // Marker writing on a white board: page text laid onto the scene.
        className="pointer-events-none h-43 w-75 overflow-hidden px-4.5 py-3.5 select-none"
        zIndexRange={[5, 0]}
      >
        <Text bare as="div" size="meta" art="navy" className="block">
          <Text as="p" size="body" lines={2} className="mb-2.5 leading-5 font-bold">
            {props.task}
          </Text>
          <ul className="grid gap-1">
            {props.rows.map((row) => {
              const Icon = { working: Loader, done: Check, failed: X }[row.state];
              return (
                <Text
                  as="li"
                  bare
                  art={rowArt[row.state]}
                  key={row.agentId}
                  data-state={row.state}
                  className="flex items-center gap-2 font-semibold"
                >
                  {row.state === "working" ? (
                    <Text bare art="blue" className="flex">
                      <Icon aria-hidden="true" />
                    </Text>
                  ) : (
                    <Icon aria-hidden="true" />
                  )}
                  <OverflowFadeText>{props.names.get(row.agentId) ?? "An agent"}</OverflowFadeText>
                </Text>
              );
            })}
          </ul>
        </Text>
      </Html>
    </group>
  );
}
