import { base64Of, fingerprintOf } from "./app_file_room_marks";

export interface SavedReportLink {
  links: number;
  confirmedLink: number;
  serverBase: number | undefined;
  serverDirty: boolean;
}

export interface SavedReportsDeps {
  versioned: boolean;
  send(message: string): boolean;
  link(): SavedReportLink;
  alive(): boolean;
  settle(): void;
}

export interface SavedReports {
  readonly busy: boolean;
  send(): void;
  report(snapshot: Uint8Array, vector: Uint8Array, version?: number): void;
}

export function savedReports(deps: SavedReportsDeps): SavedReports {
  let last: { message: string; version?: number; confirmed: boolean; sentOn: number } | null = null;
  let reports = 0;
  let latest: Uint8Array | undefined;
  const send = () => {
    if (!last || last.confirmed) return;
    const { links, confirmedLink, serverBase, serverDirty } = deps.link();
    const covered = last.version !== undefined && serverBase !== undefined && serverBase >= last.version;
    if (covered && (!serverDirty || last.sentOn === links)) {
      last.confirmed = true;
      deps.settle();
      return;
    }
    if (last.sentOn === links || confirmedLink !== links) return;
    if (!deps.send(last.message)) return;
    last.sentOn = links;
    if (last.version === undefined || covered) last.confirmed = true;
    deps.settle();
  };
  return {
    get busy() {
      return reports > 0 || (last !== null && last.version !== undefined && !last.confirmed);
    },
    send,
    report(snapshot, vector, version) {
      latest = snapshot;
      reports += 1;
      void fingerprintOf(snapshot)
        .then((fingerprint) => {
          if (!deps.alive() || latest !== snapshot) return;
          last = {
            message: JSON.stringify({
              type: "file_saved",
              fingerprint,
              state_vector: base64Of(vector),
              ...(version === undefined ? {} : { version }),
            }),
            ...(deps.versioned && version !== undefined ? { version } : {}),
            confirmed: false,
            sentOn: -1,
          };
          send();
        })
        .catch(() => undefined)
        .finally(() => {
          reports -= 1;
          deps.settle();
        });
    },
  };
}
