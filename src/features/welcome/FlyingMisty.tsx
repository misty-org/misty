import sprite from "@/shared/assets/misty-cloud-expression-cycle.webp?inline";
import "./flyingMisty.css";

/** Misty drifting around its box (the welcome screen, an empty pane): two out-of-step sweeps (across, then up and down, around the middle) trace a wandering path. Fills the nearest positioned parent. */
export function FlyingMisty() {
  return (
    <div
      aria-hidden="true"
      className="misty-fly-area pointer-events-none absolute inset-0 z-0 grid place-items-center overflow-hidden"
    >
      <div className="misty-fly-x">
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
