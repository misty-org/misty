import { useEffect, useState } from "react";
import { listProfiles, type ProfileEntry } from "@/features/workspace/profileWindow";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { OptionSelect } from "@/shared/ui";

/**
 * The profile a scheduled run works in, with that profile's sign-ins. It's chosen when the
 * schedule is made. With one profile there's nothing to choose, so nothing shows.
 */
export function ScheduleProfileField({
  value,
  onChange,
}: {
  value: string;
  onChange(profile: string): void;
}) {
  const [profiles, setProfiles] = useState<ProfileEntry[]>([]);
  useEffect(() => {
    if (!hasTauriInternals()) return;
    let live = true;
    void listProfiles()
      .then((listed) => live && setProfiles(listed))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  // A schedule made elsewhere can name a profile this computer doesn't have yet.
  const options = profiles.map((profile) => ({ value: profile.id, label: profile.name }));
  if (!options.some((option) => option.value === value))
    options.push({ value, label: "Another profile" });
  if (options.length < 2) return null;
  return (
    <label>
      Profile
      <OptionSelect aria-label="Profile" value={value} options={options} onValueChange={onChange} />
    </label>
  );
}
