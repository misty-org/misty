//! The sync server's HTTP endpoints: vaults, devices and socket tickets.
use super::*;

impl SyncApi {
    pub async fn vault(&self) -> Result<Option<Vault>> {
        #[derive(Deserialize)]
        struct Response {
            vault: Option<Vault>,
        }
        let response: Response = self
            .request(reqwest::Method::GET, "vault", None::<&()>)
            .await?;
        Ok(response.vault)
    }

    /// Replaces the personal vault's password wrapper after a password change
    /// or the upgrade from a sync secret. The server accepts it only with a
    /// transition signed by the vault root, and returns the vault as stored.
    pub async fn rotate_key(
        &self,
        key_envelope: &KeyEnvelope,
        key_transition: &KeyTransition,
    ) -> Result<Vault> {
        #[derive(Serialize)]
        struct Body<'a> {
            key_envelope: &'a KeyEnvelope,
            key_transition: &'a KeyTransition,
        }
        #[derive(Deserialize)]
        struct Response {
            vault: Vault,
        }
        let response: Response = self
            .request(
                reqwest::Method::PUT,
                "vault/key",
                Some(&Body {
                    key_envelope,
                    key_transition,
                }),
            )
            .await?;
        if response.vault.key_envelope.as_ref() != Some(key_envelope)
            || response.vault.key_transition.as_ref() != Some(key_transition)
        {
            return Err(Error::Identity);
        }
        Ok(response.vault)
    }

    /// Deletes the account's vault and every Space vault sealed to it, so a
    /// new one can be created. Reports whether a vault existed. The password
    /// (in the desktop app, the credential derived from it) confirms it: a
    /// session alone cannot destroy every device's synced data.
    pub async fn delete_vault(&self, current_password: &str) -> Result<bool> {
        #[derive(Serialize)]
        struct Body<'a> {
            current_password: &'a str,
        }
        #[derive(Deserialize)]
        struct Response {
            deleted: bool,
        }
        let response: Response = self
            .request(
                reqwest::Method::DELETE,
                "vault",
                Some(&Body { current_password }),
            )
            .await?;
        Ok(response.deleted)
    }

    pub async fn bootstrap(
        &self,
        root_public_key: &str,
        key_envelope: &KeyEnvelope,
        device: &DeviceGrant,
    ) -> Result<()> {
        #[derive(Serialize)]
        struct Body<'a> {
            root_public_key: &'a str,
            key_envelope: &'a KeyEnvelope,
            device: &'a DeviceGrant,
        }
        #[derive(Deserialize)]
        struct Response {
            vault_id: String,
        }
        let response: Response = self
            .request(
                reqwest::Method::POST,
                "vault",
                Some(&Body {
                    root_public_key,
                    key_envelope,
                    device,
                }),
            )
            .await?;
        if response.vault_id != device.vault_id {
            return Err(Error::Identity);
        }
        Ok(())
    }

    /// Every vault the account holds, the personal one first.
    pub async fn vaults(&self) -> Result<Vec<SpaceVault>> {
        #[derive(Deserialize)]
        struct Response {
            vaults: Vec<SpaceVault>,
        }
        let response: Response = self
            .request(reqwest::Method::GET, "vaults", None::<&()>)
            .await?;
        Ok(response.vaults)
    }

    /// Creates the account's vault for a Space it belongs to, its root sealed
    /// to the personal root and granted to a device already in the personal vault.
    pub async fn create_space_vault(
        &self,
        space_id: &str,
        root_public_key: &str,
        space_key_envelope: &Envelope,
        device: &DeviceGrant,
    ) -> Result<()> {
        #[derive(Serialize)]
        struct Body<'a> {
            space_id: &'a str,
            root_public_key: &'a str,
            space_key_envelope: &'a Envelope,
            device: &'a DeviceGrant,
        }
        #[derive(Deserialize)]
        struct Response {
            vault_id: String,
            space_id: String,
        }
        let response: Response = self
            .request(
                reqwest::Method::POST,
                "vaults",
                Some(&Body {
                    space_id,
                    root_public_key,
                    space_key_envelope,
                    device,
                }),
            )
            .await?;
        if response.vault_id != device.vault_id || response.space_id != space_id {
            return Err(Error::Identity);
        }
        Ok(())
    }

    pub async fn enroll(&self, grant: &DeviceGrant) -> Result<()> {
        #[derive(Deserialize)]
        struct Response {
            device_id: String,
        }
        let response: Response = self
            .request(reqwest::Method::POST, "devices", Some(grant))
            .await?;
        if response.device_id != grant.device_id {
            return Err(Error::Identity);
        }
        Ok(())
    }

    pub async fn devices(&self) -> Result<Vec<Device>> {
        #[derive(Deserialize)]
        struct Response {
            devices: Vec<Device>,
        }
        let mut endpoint = self.endpoint("devices");
        if let Some(vault_id) = &self.vault_id {
            endpoint.query_pairs_mut().append_pair("vault_id", vault_id);
        }
        let response: Response = self
            .request_to(reqwest::Method::GET, endpoint, None::<&()>)
            .await?;
        Ok(response.devices)
    }

    /// `workspace_id` asks an activated device to claim that workspace instead of its own.
    pub async fn control_device(
        &self,
        device_id: &str,
        full_sync: Option<bool>,
        activate: bool,
        workspace_id: Option<&str>,
    ) -> Result<String> {
        let mut body = serde_json::json!({
            "device_id": device_id, "full_sync": full_sync, "activate": activate,
        });
        if let Some(workspace) = workspace_id {
            body["workspace_id"] = workspace.into();
        }
        let response: serde_json::Value = self
            .request(reqwest::Method::POST, "control", Some(&body))
            .await?;
        Ok(response["operation_id"]
            .as_str()
            .unwrap_or_default()
            .to_owned())
    }

    /// Announces this device's controls and OS. The name is the user's to
    /// choose (`rename_device`), so it is never overwritten here.
    pub async fn advertise_controls(&self, device_id: &str, os_version: &str) -> Result<()> {
        let _: serde_json::Value = self
            .request(
                reqwest::Method::POST,
                "control",
                Some(&serde_json::json!({
                    "device_id": device_id, "control_version": 3,
                    "platform": std::env::consts::OS,
                    "os_version": os_version.chars().take(64).collect::<String>(),
                })),
            )
            .await?;
        Ok(())
    }

    pub async fn rename_device(&self, device_id: &str, name: &str) -> Result<()> {
        let _: serde_json::Value = self
            .request(
                reqwest::Method::POST,
                "control",
                Some(&serde_json::json!({ "device_id": device_id, "display_name": name })),
            )
            .await?;
        Ok(())
    }

    pub(super) async fn ticket(&self, scope: &VaultScope, device_id: &str) -> Result<String> {
        #[derive(Serialize)]
        struct Body<'a> {
            vault_id: &'a str,
            device_id: &'a str,
            protocol_version: u8,
        }
        #[derive(Deserialize)]
        struct Response {
            ticket: String,
            expires_in: u32,
        }
        let response: Response = self
            .request(
                reqwest::Method::POST,
                "ticket",
                Some(&Body {
                    vault_id: &scope.vault_id,
                    device_id,
                    protocol_version: PROTOCOL_VERSION,
                }),
            )
            .await?;
        if !(32..=128).contains(&response.ticket.len())
            || response.expires_in == 0
            || response.expires_in > 60
            || !response
                .ticket
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        {
            return Err(Error::Invalid);
        }
        Ok(response.ticket)
    }
}
