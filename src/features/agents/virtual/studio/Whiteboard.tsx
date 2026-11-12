import { Html } from "@react-three/drei";
import { Check, Loader, X } from "lucide-react";
import type { BoardRow } from "../studioTalk";
import { Box, Cyl } from "./parts";

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
        className="virtual-studio-board"
        zIndexRange={[5, 0]}
      >
        <p className="virtual-studio-board-task">{props.task}</p>
        <ul>
          {props.rows.map((row) => {
            const Icon = { working: Loader, done: Check, failed: X }[row.state];
            return (
              <li key={row.agentId} data-state={row.state}>
                <Icon size={14} strokeWidth={2.6} aria-hidden="true" />
                <span>{props.names.get(row.agentId) ?? "An agent"}</span>
              </li>
            );
          })}
        </ul>
      </Html>
    </group>
  );
}
