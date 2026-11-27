import { useCallback, useEffect, useState } from "react";
import { disk } from "@/features/files";
import { messageOf } from "./format";

export type DiskGrant =
  | { status: "checking" }
  | { status: "failed"; message: string }
  | { status: "off" | "on" | "declined" };

export function useDiskGrant() {
  const [grant, setGrant] = useState<DiskGrant>({ status: "checking" });
  const [asking, setAsking] = useState(false);

  const check = useCallback(() => {
    setGrant({ status: "checking" });
    void disk.granted().then(
      (on) => setGrant({ status: on ? "on" : "off" }),
      (cause) =>
        setGrant({
          status: "failed",
          message: messageOf(cause, "Misty couldn't check its access to your files."),
        }),
    );
  }, []);
  useEffect(check, [check]);

  const ask = () => {
    setAsking(true);
    void disk
      .grant()
      .then(
        (on) => setGrant({ status: on ? "on" : "declined" }),
        () => setGrant({ status: "declined" }),
      )
      .finally(() => setAsking(false));
  };

  return { grant, asking, check, ask };
}
