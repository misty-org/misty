// Sharp is native Node code. Midscene loads it only under Node, which the app never is.
export default function sharp(): never {
  throw new Error("sharp is unavailable in the Misty app");
}
