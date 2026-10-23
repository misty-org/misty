//! Device grants, signed mutations and locally sealed data under the vault root.
use super::*;

impl VaultRoot {
    pub fn grant(
        &self,
        scope: &VaultScope,
        device_id: &str,
        epoch: u64,
        device: &DeviceKey,
    ) -> Result<DeviceGrant> {
        scope.validate()?;
        let mut grant = DeviceGrant {
            vault_id: scope.vault_id.clone(),
            device_id: device_id.into(),
            key_epoch: epoch,
            public_key: device.public_key(),
            signature: String::new(),
        };
        grant.signature =
            STANDARD.encode(self.signing_key()?.sign(&grant.signing_bytes()?).to_bytes());
        Ok(grant)
    }

    pub fn verify_grant(&self, scope: &VaultScope, grant: &DeviceGrant) -> Result<()> {
        scope.validate()?;
        if grant.vault_id != scope.vault_id {
            return Err(Error::Identity);
        }
        let signature = Signature::from_bytes(&decode_fixed(&grant.signature)?);
        self.signing_key()?
            .verifying_key()
            .verify_strict(&grant.signing_bytes()?, &signature)
            .map_err(|_| Error::Identity)
    }

    fn mutation_aad(scope: &VaultScope, mutation: &Mutation) -> Result<Vec<u8>> {
        scope.aad(
            "misty.sync.payload.v1",
            &(
                &mutation.operation_id,
                &mutation.device_id,
                mutation.device_counter,
                mutation.key_epoch,
            ),
        )
    }

    pub fn seal_mutation(
        &self,
        scope: &VaultScope,
        grant: &DeviceGrant,
        device: &DeviceKey,
        operation_id: &str,
        device_counter: u64,
        plaintext: &[u8],
    ) -> Result<Mutation> {
        self.verify_grant(scope, grant)?;
        if grant.public_key != device.public_key()
            || !valid_id(operation_id)
            || !counter(device_counter)
        {
            return Err(Error::Identity);
        }
        let mut mutation = Mutation {
            vault_id: scope.vault_id.clone(),
            operation_id: operation_id.into(),
            device_id: grant.device_id.clone(),
            device_counter,
            key_epoch: grant.key_epoch,
            envelope: Envelope {
                version: 1,
                nonce: String::new(),
                ciphertext: String::new(),
            },
            signature: String::new(),
        };
        let key = self.derive(
            "misty.sync.event-key.v1",
            &(&scope.vault_id, grant.key_epoch),
        )?;
        mutation.envelope = encrypt(
            key.as_ref(),
            plaintext,
            &Self::mutation_aad(scope, &mutation)?,
            MAX_EVENT_BYTES,
        )?;
        mutation.signature = device.sign(&mutation.signing_bytes()?);
        Ok(mutation)
    }

    /// A revoked device's historical signed events may still be replayed. Live
    /// authorization belongs to the server; grant authenticity is verified here.
    pub fn open_mutation(
        &self,
        scope: &VaultScope,
        grant: &DeviceGrant,
        mutation: &Mutation,
    ) -> Result<Zeroizing<Vec<u8>>> {
        self.verify_grant(scope, grant)?;
        if mutation.vault_id != scope.vault_id
            || mutation.device_id != grant.device_id
            || mutation.key_epoch != grant.key_epoch
        {
            return Err(Error::Identity);
        }
        let public = VerifyingKey::from_bytes(&decode_fixed(&grant.public_key)?)
            .map_err(|_| Error::Identity)?;
        let signature = Signature::from_bytes(&decode_fixed(&mutation.signature)?);
        public
            .verify_strict(&mutation.signing_bytes()?, &signature)
            .map_err(|_| Error::Identity)?;
        let key = self.derive(
            "misty.sync.event-key.v1",
            &(&scope.vault_id, mutation.key_epoch),
        )?;
        decrypt(
            key.as_ref(),
            &mutation.envelope,
            &Self::mutation_aad(scope, mutation)?,
            MAX_EVENT_BYTES,
        )
    }

    pub(crate) fn seal_local(
        &self,
        scope: &VaultScope,
        device_id: &str,
        record: &str,
        plaintext: &[u8],
    ) -> Result<Envelope> {
        if !valid_id(device_id) {
            return Err(Error::Invalid);
        }
        let key = self.derive("misty.sync.local-key.v1", &(device_id, &scope.vault_id))?;
        encrypt(
            key.as_ref(),
            plaintext,
            &scope.aad("misty.sync.local-record.v1", &(device_id, record))?,
            MAX_LOCAL_BYTES,
        )
    }

    pub(crate) fn open_local(
        &self,
        scope: &VaultScope,
        device_id: &str,
        record: &str,
        envelope: &Envelope,
    ) -> Result<Zeroizing<Vec<u8>>> {
        if !valid_id(device_id) {
            return Err(Error::Invalid);
        }
        let key = self.derive("misty.sync.local-key.v1", &(device_id, &scope.vault_id))?;
        decrypt(
            key.as_ref(),
            envelope,
            &scope.aad("misty.sync.local-record.v1", &(device_id, record))?,
            MAX_LOCAL_BYTES,
        )
    }
}
