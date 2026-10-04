/**
 * Each submission, cancellation and account change starts a new epoch. Async
 * work that finishes under an older epoch is stale and must not touch the store.
 */
let epoch = 0;
export const submissionEpoch = () => epoch;
export const advanceSubmissionEpoch = () => ++epoch;
