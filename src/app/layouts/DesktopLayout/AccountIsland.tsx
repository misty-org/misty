import { Settings } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  Button,
  DropdownMenu,
  DropdownMenuTrigger,
  FaceEdit,
  FileInput,
  IconButton,
  Text,
  Tooltip,
  useNotice,
} from "@misty/ui";
import { BannerDialog, useAccountPictureEditor } from "@/features/account";
import { CallAudioControls } from "@/features/direct";
import { openSettings, preloadSettingsWorkspace } from "@/features/settings";
import { PICTURE_TYPES } from "@/shared/lib/square_png";
import { AccountNavButton } from "./NavRail";
import { AccountMenu } from "./AccountMenu";
import {
  CustomStatusDialog,
  useMyCustomStatus,
  useMyShownPresence,
  useStatusMirror,
} from "./StatusMenu";

const rowButtonClass =
  "flex h-auto min-h-8 min-w-0 shrink items-center gap-2 rounded-lg py-0 pr-2.5 pl-1";

export function AccountIsland(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenAccountSettings: () => void;
  settingsOpen: boolean;
  onSettingsClick: () => void;
  sessionExpired?: boolean;
  onSignIn: (again: boolean) => void;
}) {
  const expired = Boolean(props.sessionExpired);
  useStatusMirror();
  const presence = useMyShownPresence();
  const picture = useAccountPictureEditor();
  const customStatus = useMyCustomStatus();
  const bannerInput = useRef<HTMLInputElement>(null);
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const [statusOpen, setStatusOpen] = useState(false);
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  useEffect(() => {
    if (!expired) setNoticeDismissed(false);
  }, [expired]);
  useNotice(expired && !noticeDismissed, {
    message: "You've been signed out. Sign in to get your Spaces and sync back.",
    action: {
      label: "Sign in",
      onSelect: () => {
        setNoticeDismissed(true);
        props.onSignIn(true);
      },
    },
    onDismiss: () => setNoticeDismissed(true),
  });
  return (
    <div
      className="flex h-8 shrink-0 items-center gap-1.5"
      data-browser-toolbar
      data-sidebar
      data-misty-window-drag-block="true"
      data-account-island="true"
      data-tour="account"
    >
      {expired ? (
        <Button
          variant="quiet"
          className="mr-auto border-0"
          onClick={() => props.onSignIn(expired)}
        >
          <Text bare tone="default">
            Sign in
          </Text>
        </Button>
      ) : (
        <DropdownMenu open={props.open} onOpenChange={props.onOpenChange} modal={false}>
          <span className="relative flex min-w-0 shrink">
            <Tooltip content="Account">
              <DropdownMenuTrigger asChild>
                <AccountNavButton
                  open={props.open}
                  showAccountName
                  presence={presence}
                  line={customStatus || undefined}
                  className={rowButtonClass}
                />
              </DropdownMenuTrigger>
            </Tooltip>
            <span className="absolute inset-y-0 left-1 my-auto size-7">
              <FaceEdit onEdit={picture.open} label="Edit picture" />
            </span>
          </span>
          <AccountMenu
            onClose={() => props.onOpenChange(false)}
            onOpenAccountSettings={props.onOpenAccountSettings}
            onChangeBanner={() => {
              props.onOpenChange(false);
              bannerInput.current?.click();
            }}
            onChangePicture={() => {
              props.onOpenChange(false);
              picture.open();
            }}
            onCustomStatus={() => {
              props.onOpenChange(false);
              setStatusOpen(true);
            }}
          />
        </DropdownMenu>
      )}
      <FileInput
        ref={bannerInput}
        accept={PICTURE_TYPES}
        aria-label="Banner"
        onChange={(event) => {
          setBannerFile(event.target.files?.[0] ?? null);
          event.target.value = "";
        }}
      />
      <BannerDialog file={bannerFile} onClose={() => setBannerFile(null)} />
      {picture.dialog}
      <CustomStatusDialog open={statusOpen} onOpenChange={setStatusOpen} />
      <div className="ml-auto flex flex-none items-center gap-2">
        {expired ? null : <CallAudioControls onVoiceSettings={() => openSettings("voice")} />}
        <IconButton
          label="Settings"
          variant="secondary"
          aria-pressed={props.settingsOpen}
          onPointerEnter={() => void preloadSettingsWorkspace().catch(() => undefined)}
          onFocus={() => void preloadSettingsWorkspace().catch(() => undefined)}
          onClick={props.onSettingsClick}
        >
          <Settings />
        </IconButton>
      </div>
    </div>
  );
}
