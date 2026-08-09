export interface AppRouteMemoryStore {
  lastAppRoute: string;
  lastSpacesRoute: string;
  rememberAppRoute: (path: string) => void;
  resetAppRoute: () => void;
}
