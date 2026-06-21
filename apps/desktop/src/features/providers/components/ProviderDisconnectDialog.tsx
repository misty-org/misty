import { iconAssets } from "../../../shared/assets/icons";
import { AssetIcon } from "../../../shared/components/AssetIcon";

export function ProviderDisconnectDialog(props: {
  remoteName: string;
  working: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="provider-disconnect-dialog" role="dialog" aria-modal="true" aria-labelledby="disconnect-remote-title">
        <h2 id="disconnect-remote-title">Disconnect Remote?</h2>
        <p>
          <strong>{props.remoteName}</strong> will be removed from Misty and rclone. Files stored by the provider will not be deleted.
        </p>
        <footer>
          <button type="button" onClick={props.onCancel} disabled={props.working}>Cancel</button>
          <button className="danger" type="button" onClick={props.onConfirm} disabled={props.working}>
            <AssetIcon src={iconAssets.trash24} size={16} />
            {props.working ? "Disconnecting…" : "Disconnect"}
          </button>
        </footer>
      </section>
    </div>
  );
}
