import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

// One file for desktop renderer configuration. Shell/CI values take precedence.
export function loadAppEnv(root, environment = process.env) {
  const profile = environment.MISTY_APP_ENV?.trim().toLowerCase();
  if (profile && !/^[a-z0-9][a-z0-9-]{0,31}$/.test(profile)) {
    throw new Error("MISTY_APP_ENV must be a simple environment name, such as staging");
  }

  const path = resolve(root, profile ? `.env.${profile}` : ".env");
  if (profile && !existsSync(path)) {
    throw new Error(`Desktop environment file ${path} does not exist`);
  }
  return { ...(existsSync(path) ? parseEnv(readFileSync(path, "utf8")) : {}), ...environment };
}

export function publicAppEnv(env) {
  return Object.fromEntries(Object.entries(env)
    .filter(([key, value]) => key.startsWith("VITE_") && value !== undefined)
    .map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)]));
}

export function appEnvironmentUpdates(root) {
  const path = resolve(root, ".env");
  return {
    name: "misty-app-environment",
    configureServer(server) {
      server.watcher.add(path);
      const reload = (changed) => {
        if (resolve(changed) === path) void server.restart();
      };
      for (const event of ["add", "change", "unlink"]) server.watcher.on(event, reload);
      server.httpServer?.once("close", () => {
        for (const event of ["add", "change", "unlink"]) server.watcher.off(event, reload);
      });
    },
  };
}
