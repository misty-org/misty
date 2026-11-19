/*
 * What agents use to work on a video project without an editor open: read it, edit it, look at
 * frames of it, hear it, and render it. Loaded after OpenCut's core (`loadVideoProjectTools`).
 */
export { describeVideoProject } from "./describe";
export { editVideoProject, FRAMES, type VideoEdit } from "./edits";
export { exportVideoProject, renderFrames, timelineAudio } from "./render";
