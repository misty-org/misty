import { memo } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import type { DeskLook } from "../studioLooks";
import type { ScreenKind } from "./DeskScreen";
import {
  Aquarium,
  Arcade,
  Beanbag,
  IndoorTree,
  InsideWall,
  TrophyShelf,
  Vending,
} from "./FurnitureFun";
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
  /** For a desk, a result waits on it to be collected. */
  parcel?: boolean;
  glow: boolean;
  /** How many trophies a trophy shelf holds: the milestones the studio has reached. */
  trophies?: number;
  onGrab?: Grab;
  /** Using the piece outside build mode, such as playing the arcade cabinet. */
  onUse?(item: StudioItem): void;
}) {
  const { item, onGrab } = props;
  const at = itemCenter(item);
  const shape = {
    desk: (
      <Desk
        id={item.id}
        screen={props.screen}
        still={props.still}
        decor={props.decor}
        parcel={props.parcel}
      />
    ),
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
    wall: <InsideWall />,
    beanbag: <Beanbag id={item.id} />,
    arcade: <Arcade id={item.id} still={props.still} />,
    aquarium: <Aquarium id={item.id} still={props.still} />,
    trophies: <TrophyShelf trophies={props.trophies ?? 0} />,
    vending: <Vending />,
    tree: <IndoorTree id={item.id} />,
  }[item.kind];
  const { onUse } = props;
  const usable = !onGrab && onUse;
  return (
    <group
      position={[at.x, 0, at.z]}
      rotation={[0, yawOf(item.rot), 0]}
      onPointerDown={onGrab ? (event) => onGrab(item, event) : undefined}
      onClick={
        onGrab
          ? (event) => event.stopPropagation()
          : usable
            ? (event) => {
                event.stopPropagation();
                onUse(item);
              }
            : undefined
      }
      onPointerOver={
        onGrab || usable
          ? () => (document.body.style.cursor = onGrab ? "grab" : "pointer")
          : undefined
      }
      onPointerOut={onGrab || usable ? () => (document.body.style.cursor = "") : undefined}
    >
      {shape}
    </group>
  );
});
