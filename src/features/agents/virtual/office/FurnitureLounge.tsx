import { hashOf } from "./look";
import { Ball, Box, Cyl } from "./parts";

const fabrics = ["#5b8e7d", "#c8664a", "#4f6d8f", "#d9a441", "#8a6fa8"];
const fabricOf = (id: string) => fabrics[hashOf(id) % fabrics.length]!;
const LEG = "#7a5a3c";

/** Darken a colour a touch, for the parts of a sofa that sit behind its cushions. */
function shade(hex: string, by = 0.84): string {
  const part = (at: number) =>
    Math.round(parseInt(hex.slice(at, at + 2), 16) * by)
      .toString(16)
      .padStart(2, "0");
  return `#${part(1)}${part(3)}${part(5)}`;
}

function Seating({ id, wide }: { id: string; wide: number }) {
  const cloth = fabricOf(id);
  const frame = shade(cloth);
  const cushions = wide > 1.2 ? [-wide / 4 + 0.05, wide / 4 - 0.05] : [0];
  const cushion = wide > 1.2 ? wide / 2 - 0.22 : wide - 0.34;
  return (
    <group>
      {[-1, 1].flatMap((x) =>
        [-1, 1].map((z) => (
          <Cyl
            key={`${x}:${z}`}
            r={[0.035, 0.025]}
            h={0.1}
            at={[x * (wide / 2 - 0.1), 0.05, z * 0.32]}
            color={LEG}
            shadow={false}
          />
        )),
      )}
      <Box size={[wide, 0.2, 0.86]} at={[0, 0.2, 0]} color={frame} round={0.06} />
      <Box size={[wide, 0.56, 0.22]} at={[0, 0.48, -0.32]} color={frame} round={0.08} />
      <Box size={[0.2, 0.36, 0.86]} at={[-wide / 2 + 0.1, 0.36, 0]} color={frame} round={0.08} />
      <Box size={[0.2, 0.36, 0.86]} at={[wide / 2 - 0.1, 0.36, 0]} color={frame} round={0.08} />
      {cushions.map((x) => (
        <group key={x}>
          <Box size={[cushion, 0.1, 0.6]} at={[x, 0.29, 0.1]} color={cloth} round={0.045} />
          <Box
            size={[cushion, 0.36, 0.12]}
            at={[x, 0.55, -0.17]}
            color={cloth}
            round={0.05}
            turn={[-0.12, 0, 0]}
          />
        </group>
      ))}
    </group>
  );
}

export const Sofa = ({ id }: { id: string }) => <Seating id={id} wide={1.96} />;
export const Armchair = ({ id }: { id: string }) => <Seating id={id} wide={0.98} />;

export function CoffeeTable() {
  return (
    <group>
      <Box size={[1.5, 0.06, 0.66]} at={[0, 0.3, 0]} color="#dcbd8f" round={0.028} />
      <Box size={[1.3, 0.03, 0.5]} at={[0, 0.12, 0]} color="#c9a877" round={0.012} shadow={false} />
      {[-1, 1].flatMap((x) =>
        [-1, 1].map((z) => (
          <Cyl
            key={`${x}:${z}`}
            r={0.03}
            h={0.28}
            at={[x * 0.66, 0.14, z * 0.25]}
            color={LEG}
            shadow={false}
          />
        )),
      )}
      <Box
        size={[0.3, 0.04, 0.22]}
        at={[-0.35, 0.35, 0.05]}
        color="#3d5a80"
        turn={[0, 0.3, 0]}
        shadow={false}
      />
      <Box
        size={[0.26, 0.035, 0.2]}
        at={[-0.34, 0.388, 0.05]}
        color="#e9c46a"
        turn={[0, -0.1, 0]}
        shadow={false}
      />
      <Cyl r={0.05} h={0.09} at={[0.3, 0.375, -0.08]} color="#f4f1de" shadow={false} />
      <Cyl r={[0.1, 0.07]} h={0.05} at={[0.52, 0.355, 0.12]} color="#c8664a" shadow={false} />
    </group>
  );
}

/** A potted plant: a tall one with a trunk, or a bushy one, depending on which plant it is. */
export function Plant({ id }: { id: string }) {
  const seed = hashOf(id);
  const pot = ["#c8664a", "#f1ede4", "#4f6d8f", "#d9a441"][seed % 4]!;
  const tall = (seed >>> 3) % 2 === 0;
  const greens = ["#4f9d5d", "#3f8a52", "#66b06a", "#2f7a48"];
  return (
    <group>
      <Cyl r={[0.24, 0.17]} h={0.36} at={[0, 0.18, 0]} color={pot} sides={18} />
      <Cyl r={0.215} h={0.03} at={[0, 0.35, 0]} color="#4a3628" shadow={false} />
      {tall ? (
        <>
          <Cyl r={[0.03, 0.045]} h={0.8} at={[0, 0.74, 0]} color="#7a5a3c" sides={8} />
          <Ball r={0.3} at={[0, 1.3, 0]} color={greens[0]!} facets />
          <Ball r={0.22} at={[0.2, 1.12, 0.1]} color={greens[1]!} facets />
          <Ball r={0.2} at={[-0.2, 1.16, -0.08]} color={greens[2]!} facets />
          <Ball r={0.18} at={[0.02, 1.56, 0.04]} color={greens[2]!} facets />
        </>
      ) : (
        <>
          {[0, 1, 2, 3, 4, 5, 6].map((leaf) => {
            const turn = (leaf / 7) * Math.PI * 2 + (seed % 7);
            const lean = 0.35 + (leaf % 3) * 0.14;
            return (
              <group key={leaf} rotation={[0, turn, 0]}>
                <Ball
                  r={0.12}
                  at={[0, 0.62 + (leaf % 2) * 0.14, 0.16 + (leaf % 3) * 0.03]}
                  scale={[0.8, 2.4, 0.45]}
                  turn={[lean, 0, 0]}
                  color={greens[leaf % greens.length]!}
                  facets
                />
              </group>
            );
          })}
          <Ball r={0.16} at={[0, 0.82, 0]} scale={[0.7, 2, 0.7]} color={greens[1]!} facets />
        </>
      )}
    </group>
  );
}

/** A floor lamp. Its shade glows, and it throws a little warm light of its own. */
export function Lamp({ glow }: { glow: boolean }) {
  return (
    <group>
      <Cyl r={0.2} h={0.04} at={[0, 0.02, 0]} color="#4a4f5a" />
      <Cyl r={0.02} h={1.45} at={[0, 0.76, 0]} color="#4a4f5a" sides={8} />
      <Cyl
        r={[0.15, 0.25]}
        h={0.32}
        at={[0, 1.58, 0]}
        color="#ffe9b8"
        glow="#ffcf7a"
        glowPower={1.1}
        shadow={false}
      />
      {glow ? (
        <pointLight position={[0, 1.45, 0]} color="#ffd9a0" intensity={7} distance={6} decay={2} />
      ) : null}
    </group>
  );
}

/** A rug: it lies under the furniture and figures walk over it. */
export function Rug({ id }: { id: string }) {
  const seed = hashOf(id);
  const [field, border] = (
    [
      ["#e8dcc6", "#b9c9b3"],
      ["#d9c7a7", "#c8664a"],
      ["#cfd8dc", "#4f6d8f"],
      ["#ead7b0", "#d9a441"],
    ] as const
  )[seed % 4]!;
  return (
    <group>
      <Box
        size={[3.84, 0.024, 2.84]}
        at={[0, 0.012, 0]}
        color={border}
        round={0.011}
        shadow={false}
      />
      <Box size={[3.5, 0.026, 2.5]} at={[0, 0.014, 0]} color={field} round={0.012} shadow={false} />
      <Box
        size={[3.1, 0.028, 2.1]}
        at={[0, 0.0145, 0]}
        color={border}
        round={0.012}
        shadow={false}
      />
      <Box size={[3.0, 0.03, 2.0]} at={[0, 0.015, 0]} color={field} round={0.012} shadow={false} />
    </group>
  );
}
