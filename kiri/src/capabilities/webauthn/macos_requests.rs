//! Builds AuthenticationServices requests from what Kiri validated: the
//! platform (passkey) request and, where the system supports it, a security
//! key request, so one system sheet offers both.

use super::{array, class, data, made, responds, string, Id};
use crate::capabilities::webauthn::{Attachment, CreateRequest, GetRequest};
use crate::KiriError;
use objc::{msg_send, sel, sel_impl};

#[link(name = "AuthenticationServices", kind = "framework")]
extern "C" {
    static ASAuthorizationPublicKeyCredentialUserVerificationPreferencePreferred: Id;
    static ASAuthorizationPublicKeyCredentialUserVerificationPreferenceRequired: Id;
    static ASAuthorizationPublicKeyCredentialUserVerificationPreferenceDiscouraged: Id;
    static ASAuthorizationPublicKeyCredentialAttestationKindNone: Id;
    static ASAuthorizationPublicKeyCredentialAttestationKindDirect: Id;
    static ASAuthorizationPublicKeyCredentialAttestationKindIndirect: Id;
    static ASAuthorizationPublicKeyCredentialAttestationKindEnterprise: Id;
    static ASAuthorizationPublicKeyCredentialResidentKeyPreferenceDiscouraged: Id;
    static ASAuthorizationPublicKeyCredentialResidentKeyPreferencePreferred: Id;
    static ASAuthorizationPublicKeyCredentialResidentKeyPreferenceRequired: Id;
    fn ASAuthorizationAllSupportedPublicKeyCredentialDescriptorTransports() -> Id;
}

unsafe fn verification(value: &str) -> Id {
    match value {
        "required" => ASAuthorizationPublicKeyCredentialUserVerificationPreferenceRequired,
        "discouraged" => ASAuthorizationPublicKeyCredentialUserVerificationPreferenceDiscouraged,
        _ => ASAuthorizationPublicKeyCredentialUserVerificationPreferencePreferred,
    }
}

unsafe fn attestation_kind(value: &str) -> Id {
    match value {
        "direct" => ASAuthorizationPublicKeyCredentialAttestationKindDirect,
        "indirect" => ASAuthorizationPublicKeyCredentialAttestationKindIndirect,
        "enterprise" => ASAuthorizationPublicKeyCredentialAttestationKindEnterprise,
        _ => ASAuthorizationPublicKeyCredentialAttestationKindNone,
    }
}

unsafe fn resident_key(value: &str) -> Id {
    match value {
        "required" => ASAuthorizationPublicKeyCredentialResidentKeyPreferenceRequired,
        "preferred" => ASAuthorizationPublicKeyCredentialResidentKeyPreferencePreferred,
        _ => ASAuthorizationPublicKeyCredentialResidentKeyPreferenceDiscouraged,
    }
}

unsafe fn client_data(challenge: &[u8], origin: &str) -> Result<Id, KiriError> {
    let data_class = class("ASPublicKeyCredentialClientData")?;
    let allocated: Id = msg_send![data_class, alloc];
    Ok(made(msg_send![allocated, initWithChallenge: data(challenge) origin: string(origin)]))
}

unsafe fn provider_for(name: &str, rp_id: &str) -> Result<Id, KiriError> {
    let allocated: Id = msg_send![class(name)?, alloc];
    Ok(made(msg_send![allocated, initWithRelyingPartyIdentifier: string(rp_id)]))
}

unsafe fn platform_descriptors(ids: &[Vec<u8>]) -> Result<Id, KiriError> {
    let descriptor = class("ASAuthorizationPlatformPublicKeyCredentialDescriptor")?;
    let items: Vec<Id> = ids
        .iter()
        .map(|id| {
            let allocated: Id = msg_send![descriptor, alloc];
            made(msg_send![allocated, initWithCredentialID: data(id)])
        })
        .collect();
    Ok(array(&items))
}

unsafe fn security_key_descriptors(ids: &[Vec<u8>]) -> Result<Id, KiriError> {
    let descriptor = class("ASAuthorizationSecurityKeyPublicKeyCredentialDescriptor")?;
    let transports = ASAuthorizationAllSupportedPublicKeyCredentialDescriptorTransports();
    let items: Vec<Id> = ids
        .iter()
        .map(|id| {
            let allocated: Id = msg_send![descriptor, alloc];
            made(msg_send![allocated, initWithCredentialID: data(id) transports: transports])
        })
        .collect();
    Ok(array(&items))
}

const SECURITY_KEY: &str = "ASAuthorizationSecurityKeyPublicKeyCredentialProvider";
const PLATFORM: &str = "ASAuthorizationPlatformPublicKeyCredentialProvider";

pub(super) unsafe fn registration_requests(request: &CreateRequest, platform: bool) -> Result<Vec<Id>, KiriError> {
    let mut requests = Vec::new();
    if platform {
        let provider = provider_for(PLATFORM, &request.rp_id)?;
        let entry: Id = msg_send![provider,
            createCredentialRegistrationRequestWithClientData: client_data(&request.challenge, &request.origin)?
            name: string(&request.user_name)
            userID: data(&request.user_id)];
        if !request.user_display_name.is_empty() {
            let _: () = msg_send![entry, setDisplayName: string(&request.user_display_name)];
        }
        let _: () = msg_send![entry, setUserVerificationPreference: verification(&request.user_verification)];
        let _: () = msg_send![entry, setAttestationPreference: attestation_kind(&request.attestation)];
        if responds(entry, sel!(setExcludedCredentials:)) {
            let _: () = msg_send![entry, setExcludedCredentials: platform_descriptors(&request.exclude)?];
        }
        requests.push(entry);
    }
    let provider = provider_for(SECURITY_KEY, &request.rp_id)?;
    let with_client_data = sel!(createCredentialRegistrationRequestWithClientData:displayName:name:userID:);
    if request.attachment != Some(Attachment::Platform) && responds(provider, with_client_data) {
        let display_name = if request.user_display_name.is_empty() {
            &request.user_name
        } else {
            &request.user_display_name
        };
        let entry: Id = msg_send![provider,
            createCredentialRegistrationRequestWithClientData: client_data(&request.challenge, &request.origin)?
            displayName: string(display_name)
            name: string(&request.user_name)
            userID: data(&request.user_id)];
        let parameters_class = class("ASAuthorizationPublicKeyCredentialParameters")?;
        let parameters: Vec<Id> = request
            .algorithms
            .iter()
            .map(|algorithm| {
                let allocated: Id = msg_send![parameters_class, alloc];
                made(msg_send![allocated, initWithAlgorithm: *algorithm as isize])
            })
            .collect();
        let _: () = msg_send![entry, setCredentialParameters: array(&parameters)];
        let _: () = msg_send![entry, setResidentKeyPreference: resident_key(&request.resident_key)];
        let _: () = msg_send![entry, setUserVerificationPreference: verification(&request.user_verification)];
        let _: () = msg_send![entry, setAttestationPreference: attestation_kind(&request.attestation)];
        let _: () = msg_send![entry, setExcludedCredentials: security_key_descriptors(&request.exclude)?];
        requests.push(entry);
    }
    Ok(requests)
}

pub(super) unsafe fn assertion_requests(request: &GetRequest, platform: bool) -> Result<Vec<Id>, KiriError> {
    let mut requests = Vec::new();
    if platform {
        let provider = provider_for(PLATFORM, &request.rp_id)?;
        let entry: Id = msg_send![provider,
            createCredentialAssertionRequestWithClientData: client_data(&request.challenge, &request.origin)?];
        if !request.allow.is_empty() {
            let _: () = msg_send![entry, setAllowedCredentials: platform_descriptors(&request.allow)?];
        }
        let _: () = msg_send![entry, setUserVerificationPreference: verification(&request.user_verification)];
        requests.push(entry);
    }
    let provider = provider_for(SECURITY_KEY, &request.rp_id)?;
    if responds(provider, sel!(createCredentialAssertionRequestWithClientData:)) {
        let entry: Id = msg_send![provider,
            createCredentialAssertionRequestWithClientData: client_data(&request.challenge, &request.origin)?];
        if !request.allow.is_empty() {
            let _: () = msg_send![entry, setAllowedCredentials: security_key_descriptors(&request.allow)?];
        }
        let _: () = msg_send![entry, setUserVerificationPreference: verification(&request.user_verification)];
        requests.push(entry);
    }
    Ok(requests)
}
