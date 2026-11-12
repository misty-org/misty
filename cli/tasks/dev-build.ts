// Every dev profile builds into the one `src-tauri/target`, like everything else, so a second
// profile costs a rebuild of the app crate rather than a second copy of every dependency.
export function checkDevelopmentProfile(
  args: string[],
  environment: NodeJS.ProcessEnv = process.env,
): void {
  if (args[0] !== "dev" || args.includes("--help") || args.includes("-h")) return;
  const profile = environment.MISTY_PROFILE;
  if (profile === undefined) return;
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(profile)) {
    throw new Error("Invalid desktop development profile name.");
  }
}
