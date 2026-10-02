export function mistyDeviceJobsEnabled(): boolean {
  // Shared global Ask execution is independent of the retired agent product.
  // Development runs the pilot; release builds still require explicit rollout.
  return true;
}
