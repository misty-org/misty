// An agent task on this device: its lease, its screen and what the person sends it while it runs.
export {
  finishLocalExecution,
  pauseLocalExecution,
  settleLocalExecution,
  useLocalExecution,
  type Execution,
} from "./localExecutionState";
export { startLocalExecution } from "./localExecutionStart";
export {
  continueQueuedLocalWork,
  queueLocalFollowup,
  routeLocalFollowup,
  steerLocalExecution,
} from "./localExecutionFollowups";
