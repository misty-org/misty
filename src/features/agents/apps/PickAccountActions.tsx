import { useEffect, useState } from "react";
import { Button, Skeleton } from "@/shared/ui";
import { appsApi, type ConnectedApp } from "./api";
import { accountLabels } from "./ConnectedAppRows";

/**
 * The buttons on a pick card: one per connected account of the card's app. The one chosen
 * becomes an account the run's Space uses.
 */
export function PickAccountActions({
  app,
  busy,
  onPick,
  onDismiss,
}: {
  app: string;
  busy: boolean;
  onPick(account: string): void;
  onDismiss(): void;
}) {
  const [accounts, setAccounts] = useState<ConnectedApp[] | null>(null);
  useEffect(() => {
    let live = true;
    const show = (result: { apps: ConnectedApp[] }) =>
      live &&
      setAccounts(result.apps.filter((item) => item.app === app && item.status === "active"));
    appsApi
      .list(show)
      .then(show)
      .catch(() => live && setAccounts([]));
    return () => {
      live = false;
    };
  }, [app]);
  if (accounts === null)
    return (
      <span role="status" aria-label="Accounts" aria-busy="true" className="flex gap-2">
        <Skeleton className="h-7 w-28 rounded-md" />
        <Skeleton className="h-7 w-28 rounded-md" />
      </span>
    );
  const labels = accountLabels(accounts);
  return (
    <>
      {accounts.map((item, index) => (
        <Button
          key={item.id}
          size="sm"
          variant={index === 0 ? "primary" : "outline"}
          disabled={busy}
          onClick={() => onPick(item.id)}
        >
          Use {labels[index]}
        </Button>
      ))}
      <Button size="sm" variant="ghost" disabled={busy} onClick={onDismiss}>
        Not now
      </Button>
    </>
  );
}
