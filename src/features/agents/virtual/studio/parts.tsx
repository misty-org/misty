import { RoundedBox } from "@react-three/drei";

type Triple = [number, number, number];

/** The top of a rug, the highest thing lying flat on the floor. */
export const RUG_TOP = 0.044;
/** Where marks drawn on the floor lie (shadows, rings, the build grid): clear of the rugs, as two
 * flat things closer than about half a centimetre share a depth from across the room and flicker. */
export const FLOOR_MARK = RUG_TOP + 0.012;

interface PartProps {
  at: Triple;
  color: string;
  turn?: Triple;
  /** Lights up in this colour, for screens and lamp shades. */
  glow?: string;
  glowPower?: number;
  /** Small parts leave the shadow to the bigger ones they sit on. */
  shadow?: boolean;
  opacity?: number;
}

function Paint(props: Pick<PartProps, "color" | "glow" | "glowPower" | "opacity">) {
  return (
    <meshStandardMaterial
      color={props.color}
      roughness={0.82}
      metalness={0}
      emissive={props.glow ?? "#000000"}
      emissiveIntensity={props.glow ? (props.glowPower ?? 1) : 0}
      transparent={props.opacity !== undefined}
      opacity={props.opacity ?? 1}
    />
  );
}

/** A block, with softened edges when `round` is given. Everything in the studio is built from
 * these few shapes, so nothing has to be downloaded. */
export function Box(props: PartProps & { size: Triple; round?: number }) {
  const shadow = props.shadow ?? true;
  if (props.round) {
    return (
      <RoundedBox
        args={props.size}
        radius={props.round}
        smoothness={3}
        position={props.at}
        rotation={props.turn}
        castShadow={shadow}
        receiveShadow
      >
        <Paint {...props} />
      </RoundedBox>
    );
  }
  return (
    <mesh position={props.at} rotation={props.turn} castShadow={shadow} receiveShadow>
      <boxGeometry args={props.size} />
      <Paint {...props} />
    </mesh>
  );
}

/** A cylinder, or a cone cut short when the top and bottom radius differ. */
export function Cyl(
  props: PartProps & { r: number | [top: number, bottom: number]; h: number; sides?: number },
) {
  const [top, bottom] = typeof props.r === "number" ? [props.r, props.r] : props.r;
  return (
    <mesh position={props.at} rotation={props.turn} castShadow={props.shadow ?? true} receiveShadow>
      <cylinderGeometry args={[top, bottom, props.h, props.sides ?? 20]} />
      <Paint {...props} />
    </mesh>
  );
}

export function Ball(props: PartProps & { r: number; scale?: Triple; facets?: boolean }) {
  return (
    <mesh
      position={props.at}
      rotation={props.turn}
      scale={props.scale}
      castShadow={props.shadow ?? true}
    >
      {props.facets ? (
        <icosahedronGeometry args={[props.r, 1]} />
      ) : (
        <sphereGeometry args={[props.r, 20, 16]} />
      )}
      <meshStandardMaterial color={props.color} roughness={0.85} flatShading={props.facets} />
    </mesh>
  );
}

/** A rounded limb or post standing upright, `h` tall in all. */
export function Capsule(props: PartProps & { r: number; h: number }) {
  return (
    <mesh position={props.at} rotation={props.turn} castShadow={props.shadow ?? true}>
      <capsuleGeometry args={[props.r, Math.max(0.001, props.h - props.r * 2), 4, 12]} />
      <Paint {...props} />
    </mesh>
  );
}
