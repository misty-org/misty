import { hashOf } from "./look";
import { Box, Cyl } from "./parts";

const WOOD = "#dcbd8f";
const WOOD_DARK = "#a9794d";
const METAL = "#4a4f5a";

/** A desk with its chair. The desk fills the back half of its footprint and the chair stands in
 * the front half, facing it. The screen lights up while the desk's agent works. */
export function Desk({ id, lit }: { id: string; lit: boolean }) {
  const quirk = hashOf(id);
  const mug = ["#e76f51", "#2a9d8f", "#e9c46a", "#f4f1de", "#7768ae"][quirk % 5]!;
  return (
    <group>
      <Box size={[1.84, 0.07, 0.84]} at={[0, 0.605, -0.5]} color={WOOD} round={0.03} />
      <Box size={[0.06, 0.58, 0.72]} at={[-0.84, 0.29, -0.5]} color={METAL} />
      <Box size={[0.06, 0.58, 0.72]} at={[0.84, 0.29, -0.5]} color={METAL} />
      <Box size={[0.42, 0.46, 0.66]} at={[0.58, 0.33, -0.5]} color="#efe9df" round={0.03} />
      <Box size={[0.3, 0.02, 0.03]} at={[0.58, 0.44, -0.16]} color={METAL} shadow={false} />
      <Box size={[0.3, 0.02, 0.03]} at={[0.58, 0.26, -0.16]} color={METAL} shadow={false} />
      {/* Screen on its stand, facing the chair. */}
      <Cyl r={0.13} h={0.02} at={[0, 0.65, -0.74]} color={METAL} shadow={false} />
      <Box size={[0.05, 0.2, 0.04]} at={[0, 0.75, -0.76]} color={METAL} shadow={false} />
      <Box size={[0.78, 0.46, 0.045]} at={[0, 1.0, -0.74]} color="#2b2f38" round={0.02} />
      <Box
        size={[0.71, 0.39, 0.012]}
        at={[0, 1.0, -0.714]}
        color={lit ? "#dff1ff" : "#171a20"}
        glow={lit ? "#9fd0ff" : undefined}
        glowPower={0.9}
        shadow={false}
      />
      {lit ? (
        <>
          <Box size={[0.42, 0.03, 0.014]} at={[-0.1, 1.1, -0.708]} color="#5c88b8" shadow={false} />
          <Box
            size={[0.52, 0.03, 0.014]}
            at={[-0.05, 1.03, -0.708]}
            color="#7aa3cc"
            shadow={false}
          />
          <Box
            size={[0.3, 0.03, 0.014]}
            at={[-0.16, 0.96, -0.708]}
            color="#5c88b8"
            shadow={false}
          />
          <Box
            size={[0.46, 0.03, 0.014]}
            at={[-0.08, 0.89, -0.708]}
            color="#7aa3cc"
            shadow={false}
          />
        </>
      ) : null}
      <Box
        size={[0.46, 0.022, 0.15]}
        at={[0, 0.652, -0.3]}
        color="#3a3e47"
        round={0.008}
        shadow={false}
      />
      <Box
        size={[0.07, 0.025, 0.1]}
        at={[0.34, 0.652, -0.3]}
        color="#f1ede4"
        round={0.01}
        shadow={false}
      />
      <Cyl r={0.045} h={0.09} at={[-0.62, 0.685, -0.42]} color={mug} shadow={false} />
      {quirk % 3 === 0 ? (
        <>
          <Cyl
            r={[0.06, 0.045]}
            h={0.09}
            at={[-0.7, 0.685, -0.74]}
            color="#f4f1de"
            shadow={false}
          />
          <Cyl
            r={[0.02, 0.07]}
            h={0.16}
            at={[-0.7, 0.8, -0.74]}
            color="#5a9a57"
            sides={6}
            shadow={false}
          />
        </>
      ) : (
        <>
          <Box
            size={[0.26, 0.03, 0.34]}
            at={[-0.66, 0.655, -0.66]}
            color="#f7f3ea"
            turn={[0, 0.2, 0]}
            shadow={false}
          />
          <Box
            size={[0.26, 0.03, 0.34]}
            at={[-0.64, 0.685, -0.66]}
            color="#c9d6df"
            turn={[0, -0.1, 0]}
            shadow={false}
          />
        </>
      )}
      <Chair />
    </group>
  );
}

function Chair() {
  return (
    <group position={[0, 0, 0.2]}>
      <Cyl r={0.26} h={0.035} at={[0, 0.03, 0]} color={METAL} sides={5} />
      <Cyl r={0.035} h={0.26} at={[0, 0.17, 0]} color={METAL} shadow={false} />
      <Box size={[0.5, 0.08, 0.46]} at={[0, 0.32, 0]} color="#3f6f8c" round={0.035} />
      <Box size={[0.05, 0.3, 0.04]} at={[0, 0.45, 0.24]} color={METAL} shadow={false} />
      <Box size={[0.48, 0.44, 0.08]} at={[0, 0.68, 0.25]} color="#3f6f8c" round={0.035} />
    </group>
  );
}

/** A round table to stand around, with a laptop and some papers left on it. */
export function MeetingTable() {
  return (
    <group>
      <Cyl r={0.5} h={0.05} at={[0, 0.025, 0]} color={METAL} sides={28} />
      <Cyl r={0.08} h={0.78} at={[0, 0.42, 0]} color={METAL} />
      <Cyl r={0.96} h={0.07} at={[0, 0.83, 0]} color={WOOD} sides={36} />
      <Cyl r={0.98} h={0.03} at={[0, 0.8, 0]} color={WOOD_DARK} sides={36} shadow={false} />
      <group position={[0.3, 0.875, 0.2]} rotation={[0, 0.5, 0]}>
        <Box size={[0.36, 0.02, 0.25]} at={[0, 0, 0]} color="#c9cdd3" shadow={false} />
        <Box
          size={[0.36, 0.24, 0.016]}
          at={[0, 0.115, -0.15]}
          color="#c9cdd3"
          turn={[-0.25, 0, 0]}
          shadow={false}
        />
        <Box
          size={[0.32, 0.2, 0.004]}
          at={[0, 0.117, -0.14]}
          color="#dff1ff"
          turn={[-0.25, 0, 0]}
          shadow={false}
        />
      </group>
      <Box
        size={[0.22, 0.012, 0.3]}
        at={[-0.35, 0.872, -0.2]}
        color="#fbf8f1"
        turn={[0, 0.3, 0]}
        shadow={false}
      />
      <Box
        size={[0.22, 0.012, 0.3]}
        at={[-0.3, 0.878, 0.25]}
        color="#fde8a8"
        turn={[0, -0.4, 0]}
        shadow={false}
      />
      <Cyl r={0.045} h={0.09} at={[0.05, 0.91, -0.45]} color="#e76f51" shadow={false} />
    </group>
  );
}

/** A big screen on a low cabinet, for the meeting corner. */
export function BigScreen() {
  return (
    <group>
      <Box size={[1.8, 0.42, 0.46]} at={[0, 0.25, -0.12]} color="#efe9df" round={0.03} />
      <Box size={[0.03, 0.34, 0.02]} at={[0, 0.25, 0.115]} color={WOOD_DARK} shadow={false} />
      <Box size={[0.12, 0.3, 0.06]} at={[0, 0.58, -0.16]} color={METAL} shadow={false} />
      <Box size={[1.62, 0.94, 0.06]} at={[0, 1.2, -0.16]} color="#23262d" round={0.03} />
      <Box
        size={[1.52, 0.84, 0.012]}
        at={[0, 1.2, -0.126]}
        color="#23395d"
        glow="#35609c"
        glowPower={0.8}
        shadow={false}
      />
      {[0.3, 0.52, 0.42, 0.66, 0.58].map((tall, index) => (
        <Box
          key={index}
          size={[0.16, tall, 0.014]}
          at={[-0.52 + index * 0.26, 0.86 + tall / 2, -0.12]}
          color={["#8ecae6", "#ffb703", "#8ecae6", "#fb8500", "#8ecae6"][index]!}
          glow={["#8ecae6", "#ffb703", "#8ecae6", "#fb8500", "#8ecae6"][index]}
          glowPower={0.5}
          shadow={false}
        />
      ))}
    </group>
  );
}

/** Shelves against a wall, full of books. */
export function Bookshelf({ id }: { id: string }) {
  const spines = [
    "#c8553d",
    "#f2a541",
    "#3d5a80",
    "#5b8e7d",
    "#7768ae",
    "#e9c46a",
    "#b56576",
    "#f4f1de",
  ];
  const seed = hashOf(id);
  return (
    <group position={[0, 0, -0.1]}>
      <Box size={[1.9, 1.78, 0.05]} at={[0, 0.89, -0.2]} color={WOOD_DARK} />
      <Box size={[0.06, 1.78, 0.44]} at={[-0.92, 0.89, 0]} color={WOOD} />
      <Box size={[0.06, 1.78, 0.44]} at={[0.92, 0.89, 0]} color={WOOD} />
      {[0.03, 0.46, 0.9, 1.34, 1.75].map((y) => (
        <Box key={y} size={[1.84, 0.05, 0.44]} at={[0, y, 0]} color={WOOD} shadow={false} />
      ))}
      {[0.055, 0.485, 0.925, 1.365].flatMap((shelf, row) =>
        [0, 1, 2, 3, 4, 5].map((slot) => {
          const pick = (seed >>> (row * 3 + slot)) % 11;
          if (pick > 8) return null;
          const tall = 0.24 + (pick % 4) * 0.035;
          const wide = 0.2 + (pick % 3) * 0.035;
          return (
            <Box
              key={`${row}:${slot}`}
              size={[wide, tall, 0.3]}
              at={[-0.74 + slot * 0.296, shelf + tall / 2, 0.02]}
              color={spines[(pick + row * 2 + slot) % spines.length]!}
              round={0.015}
              shadow={false}
            />
          );
        }),
      )}
    </group>
  );
}

/** A water cooler, where resting agents turn up now and then. */
export function Cooler() {
  return (
    <group>
      <Box size={[0.42, 0.95, 0.4]} at={[0, 0.475, 0]} color="#f3f0ea" round={0.04} />
      <Box size={[0.3, 0.22, 0.02]} at={[0, 0.66, 0.2]} color="#cfd6dc" shadow={false} />
      <Box size={[0.05, 0.05, 0.05]} at={[-0.07, 0.68, 0.22]} color="#4d9de0" shadow={false} />
      <Box size={[0.05, 0.05, 0.05]} at={[0.07, 0.68, 0.22]} color="#e4572e" shadow={false} />
      <Cyl r={[0.1, 0.16]} h={0.1} at={[0, 1.0, 0]} color="#9cc9e8" opacity={0.75} shadow={false} />
      <Cyl r={0.17} h={0.36} at={[0, 1.22, 0]} color="#9cc9e8" opacity={0.6} shadow={false} />
    </group>
  );
}
