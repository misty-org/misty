import { HomeDashboard } from "./HomeDashboard";

/** Account-wide Home never selects or inherits a Space. */
export function GlobalHomeDashboard() {
  return <HomeDashboard global />;
}
