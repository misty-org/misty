import { Vector3 } from "three";

/**
 * What the walking camera looks at: the person's own figure, at its shoulders. Inside walls read
 * it to get out of the way of that view; when nobody walks (building looks down on the room),
 * `active` is false and every wall stands.
 */
export const walkView = { active: false, target: new Vector3() };
