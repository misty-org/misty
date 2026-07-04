import { iconAssets } from "../../../shared/assets/icons";
import { AssetIcon } from "../../../shared/components/AssetIcon";

const modalBackdropClass =
  "fixed inset-0 z-[100] grid place-items-center bg-[rgba(3,7,10,0.72)] p-6";

const disconnectDialogClass =
  "flex max-h-[min(760px,calc(100vh-48px))] w-[min(440px,calc(100vw-48px))] flex-col overflow-hidden rounded-[10px] border border-[#35434e] bg-[#0d141a] pt-5 shadow-[0_28px_90px_rgba(0,0,0,0.58)]";

const disconnectFooterClass =
  "flex justify-end gap-[9px] border-t border-[#25313a] px-5 py-3.5";

const disconnectButtonClass =
  "inline-flex min-h-9 items-center justify-center gap-[7px] rounded-[7px] border border-[#35414b] bg-[#141c23] px-3.5 py-2 text-[#e8eaed] disabled:opacity-55";

const disconnectDangerButtonClass =
  `${disconnectButtonClass} border-[#743c42] bg-[#5c252c] text-[#ffdadd]`;

export function ProviderDisconnectDialog(props: {
  remoteName: string;
  working: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className={modalBackdropClass} role="presentation">
      <section className={disconnectDialogClass} role="dialog" aria-modal="true" aria-labelledby="disconnect-remote-title">
        <h2 className="mx-5 text-xl" id="disconnect-remote-title">Delete Remote?</h2>
        <p className="mx-5 mb-5 mt-2.5 leading-normal">
          <strong>{props.remoteName}</strong> will be removed from Misty and rclone. Files stored by the provider will not be deleted.
        </p>
        <footer className={disconnectFooterClass}>
          <button className={disconnectButtonClass} type="button" onClick={props.onCancel} disabled={props.working}>Cancel</button>
          <button className={disconnectDangerButtonClass} type="button" onClick={props.onConfirm} disabled={props.working}>
            <AssetIcon src={iconAssets.trash24} size={16} />
            {props.working ? "Deleting…" : "Delete"}
          </button>
        </footer>
      </section>
    </div>
  );
}
