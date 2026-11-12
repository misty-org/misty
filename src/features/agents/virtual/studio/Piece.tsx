import { memo } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import type { DeskLook } from "../studioLooks";
import type { ScreenKind } from "./DeskScreen";
import { Armchair, CoffeeTable, Lamp, Plant, Rug, Sofa } from "./FurnitureLounge";
import { BigScreen, Bookshelf, Cooler, Desk, MeetingTable } from "./FurnitureWork";
import { yawOf } from "./grid";
import { itemCenter, type StudioItem } from "./layout";

export type Grab = (item: StudioItem, event: ThreeEvent<PointerEvent>) => void;

/** One piece of furniture where the layout puts it, which can be grabbed in build mode. */
export const Piece = memo(function Piece(props: {
  item: StudioItem;
  screen: ScreenKind | null;
  still: boolean;
  /** For a desk, what its agent put on it. */
  decor?: DeskLook;
  glow: boolean;
  onGrab?: Grab;
}) {
  const { item, onGrab } = props;
  const at = itemCenter(item);
  const shape = {
    desk: <Desk id={item.id} screen={props.screen} still={props.still} decor={props.decor} />,
    sofa: <Sofa id={item.id} />,
    armchair: <Armchair id={item.id} />,
    table: <MeetingTable />,
    "coffee-table": <CoffeeTable />,
    bookshelf: <Bookshelf id={item.id} />,
    screen: <BigScreen />,
    plant: <Plant id={item.id} />,
    lamp: <Lamp glow={props.glow} />,
    cooler: <Cooler />,
    rug: <Rug id={item.id} />,
  }[item.kind];
  return (
    <group
      position={[at.x, 0, at.z]}
      rotation={[0, yawOf(item.rot), 0]}
      onPointerDown={onGrab ? (event) => onGrab(item, event) : undefined}
      onClick={onGrab ? (event) => event.stopPropagation() : undefined}
      onPointerOver={onGrab ? () => (document.body.style.cursor = "grab") : undefined}
      onPointerOut={onGrab ? () => (document.body.style.cursor = "") : undefined}
    >
      {shape}
    </group>
  );
});
