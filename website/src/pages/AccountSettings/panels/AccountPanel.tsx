import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { updateProfile, type MeResponse } from "../api";
import { AvatarUpload } from "./components/AvatarUpload";
import { DangerZone } from "./components/DangerZone";
import { DataExport } from "./components/DataExport";
import { LicenseDevice } from "./components/LicenseDevice";
import { SaveFeedback } from "../components/SaveFeedback";
import {
  customRowClass,
  GhostRow,
  Row,
  Section,
} from "../components/SettingsRows";
import { useSave } from "../useSave";

export function AccountPanel({
  me,
  onUpdated,
  onAvatarUploaded,
  onDeleted,
}: {
  me: MeResponse;
  onUpdated: (name: string) => void;
  onAvatarUploaded: () => void;
  onDeleted: () => void;
}) {
  const [name, setName] = useState(me.name);
  const { saving, error, ok, save } = useSave(async () => {
    const nextName = name.trim();
    await updateProfile(nextName);
    onUpdated(nextName);
  });
  const joined = new Date(me.created_at).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div>
      <Section title="Profile">
        <div className={`${customRowClass} flex flex-col gap-4 py-5`}>
          <AvatarUpload me={me} onUploaded={onAvatarUploaded} />

          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
            <div>
              <label
                htmlFor="account-display-name"
                className="mb-1.5 block text-xs font-medium text-foreground"
              >
                Display name
              </label>
              <Input
                id="account-display-name"
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="flex items-center gap-3 max-[520px]:flex-col max-[520px]:items-stretch">
              <Button
                type="button"
                onClick={save}
                disabled={
                  saving || name.trim() === "" || name.trim() === me.name
                }
                aria-busy={saving}
              >
                {saving ? <Spinner aria-hidden="true" /> : null}
                {saving ? "Saving…" : "Save changes"}
              </Button>
              <SaveFeedback ok={ok} error={error} />
            </div>
          </div>

          <div>
            <label
              htmlFor="account-email"
              className="mb-1.5 block text-xs font-medium text-foreground"
            >
              Email
            </label>
            <Input
              id="account-email"
              type="email"
              value={me.email}
              disabled
              aria-describedby="account-email-description"
            />
            <p
              id="account-email-description"
              className="mt-1 text-xs text-muted-foreground"
            >
              Email cannot be changed.
            </p>
          </div>
        </div>

        <Row label="Member since">{joined}</Row>
        <Row label="User id">
          <span className="font-mono text-xs text-muted-foreground">
            {me.id}
          </span>
        </Row>
      </Section>

      <Section title="License">
        <LicenseDevice me={me} />
      </Section>

      <Section title="Security">
        <div
          className={`${customRowClass} flex flex-col gap-3 md:flex-row md:items-center md:justify-between md:gap-6`}
        >
          <div>
            <p className="text-sm text-foreground">Password</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Reset via email link.
            </p>
          </div>
          <Button asChild variant="link" className="h-auto p-0">
            <a href="/signin">Reset</a>
          </Button>
        </div>
        <GhostRow label="Two-factor authentication" value="Coming soon" />
      </Section>

      <Section title="Your data">
        <DataExport />
      </Section>

      <Section title="Danger zone">
        <DangerZone onDeleted={onDeleted} />
      </Section>
    </div>
  );
}
