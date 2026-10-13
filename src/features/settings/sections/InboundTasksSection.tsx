import { useEffect, useState } from "react";
import {
  inboundChannelsApi,
  type InboundChannel,
  type InboundChannelKind,
} from "@/api/ai/inbound-channels";
import { DesktopSettingsRow, DesktopSettingsSection } from "../components/DesktopSettingsUI";
import { SwitchControl } from "../SettingsControls";

/**
 * Tasks by email or Slack (roadmap C8): forward an email to your +misty
 * address, or write "@misty" in Slack, and Misty does the task and answers in
 * the same thread. Only messages you wrote yourself start tasks.
 */
export function InboundTasksSection() {
  const [channels, setChannels] = useState<InboundChannel[]>();
  const [working, setWorking] = useState<InboundChannelKind | "">("");
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    inboundChannelsApi
      .list()
      .then((result) => live && setChannels(result.channels))
      .catch(() => live && setError("These settings couldn’t load."));
    return () => {
      live = false;
    };
  }, []);
  const find = (kind: InboundChannelKind) => channels?.find((item) => item.channel === kind);
  const toggle = async (kind: InboundChannelKind, on: boolean) => {
    if (working) return;
    setWorking(kind);
    setError("");
    try {
      if (on) {
        const { channel } = await inboundChannelsApi.enable(kind);
        setChannels((current) => [...(current ?? []).filter((c) => c.channel !== kind), channel]);
      } else {
        await inboundChannelsApi.disable(kind);
        setChannels((current) =>
          current?.map((c) => (c.channel === kind ? { ...c, enabled: false } : c)),
        );
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "This setting couldn’t be saved.");
    } finally {
      setWorking("");
    }
  };
  const gmail = find("gmail");
  const slack = find("slack");
  const note = (channel: InboundChannel | undefined, fallback: string) =>
    channel?.enabled && channel.last_error ? channel.last_error : fallback;
  return (
    <DesktopSettingsSection
      title="Tasks by email and Slack"
      description={
        "Start a task without opening Misty. It runs like any task you give Misty, on your " +
        "plan, and the answer comes back in the same thread. Only messages you wrote start tasks."
      }
    >
      <DesktopSettingsRow
        label="Email"
        description={note(
          gmail,
          gmail?.enabled && gmail.identity.task_address
            ? `Forward an email to ${gmail.identity.task_address}, with a note saying what to do. Uses your connected Gmail.`
            : "Forward an email to your own address with +misty added. Needs Gmail connected in Agents › Integrations.",
        )}
      >
        <SwitchControl
          checked={gmail?.enabled ?? false}
          disabled={!channels || Boolean(working)}
          onChange={(value) => void toggle("gmail", value)}
        />
      </DesktopSettingsRow>
      <DesktopSettingsRow
        label="Slack"
        description={note(
          slack,
          "Write @misty in any message you send, and the answer posts in its thread. Others in the channel can read it. " +
            "Needs Slack connected in Agents › Integrations.",
        )}
      >
        <SwitchControl
          checked={slack?.enabled ?? false}
          disabled={!channels || Boolean(working)}
          onChange={(value) => void toggle("slack", value)}
        />
      </DesktopSettingsRow>
      {error ? (
        <p role="alert" className="mt-2 text-xs text-cream-muted">
          {error}
        </p>
      ) : null}
    </DesktopSettingsSection>
  );
}
