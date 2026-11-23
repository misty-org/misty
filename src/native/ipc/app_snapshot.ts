export interface AppSnapshot {
  appName: string;
  version: string;
  environment: AppEnvironmentSnapshot;
}
interface AppEnvironmentSnapshot {
  homeDir: string;
}
