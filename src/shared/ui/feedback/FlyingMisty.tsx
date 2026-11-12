import sprite from "@/shared/assets/misty-cloud-expression-cycle.webp?inline";
import "./flyingMisty.css";

/** The name of the sweep across, whose every end is one pass along Misty's track. */
const crossing = "misty-fly-x";

/**
 * Misty drifting around its box (the welcome screen, an empty pane): two out-of-step sweeps
 * (across, then up and down, around the middle) trace a wandering path. Fills the nearest
 * positioned parent. `splash` is the opening screen's quicker flight; `onPass` hears each time
 * Misty reaches the end of her track, so a screen can wait for her to arrive before it leaves.
 */
export function FlyingMisty(props: { pace?: "drift" | "splash"; onPass?: () => void }) {
  return (
    <div
      aria-hidden="true"
      data-pace={props.pace ?? "drift"}
      className="misty-fly-area pointer-events-none absolute inset-0 z-0 grid place-items-center overflow-hidden"
    >
      <div
        className="misty-fly-x"
        onAnimationIteration={(event) => {
          // The bob up and down inside it ends its own passes, which bubble up here too.
          if (event.animationName === crossing) props.onPass?.();
        }}
      >
        <div className="misty-fly-y">
          <img
            src={sprite}
            width={40}
            height={40}
            alt=""
            draggable={false}
            className="size-10 object-contain"
          />
        </div>
      </div>
    </div>
  );
}
