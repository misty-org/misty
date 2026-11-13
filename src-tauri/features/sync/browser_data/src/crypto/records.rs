//! Data sealed for this computer under a key, such as workspace recovery.
use super::*;

impl RecoveryKey {
    pub(crate) fn seal_local(
        &self,
        scope: &RecoveryScope,
        device_id: &str,
        record: &str,
        plaintext: &[u8],
    ) -> Result<Envelope> {
        if !valid_id(device_id) {
            return Err(Error::Invalid);
        }
        let key = self.derive("misty.sync.local-key.v1", &(device_id, &scope.id))?;
        encrypt(
            key.as_ref(),
            plaintext,
            &scope.aad("misty.sync.local-record.v1", &(device_id, record))?,
            MAX_LOCAL_BYTES,
        )
    }

    pub(crate) fn open_local(
        &self,
        scope: &RecoveryScope,
        device_id: &str,
        record: &str,
        envelope: &Envelope,
    ) -> Result<Zeroizing<Vec<u8>>> {
        if !valid_id(device_id) {
            return Err(Error::Invalid);
        }
        let key = self.derive("misty.sync.local-key.v1", &(device_id, &scope.id))?;
        decrypt(
            key.as_ref(),
            envelope,
            &scope.aad("misty.sync.local-record.v1", &(device_id, record))?,
            MAX_LOCAL_BYTES,
        )
    }
}
