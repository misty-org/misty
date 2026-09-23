export interface AppRouteMemoryStore {
  lastAppRoute: string;
  rememberAppRoute: (path: string) => void;
  resetAppRoute: () => void;
}
