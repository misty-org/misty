// webauthn: passkeys and security keys for navigator.credentials, answered by
// the OS authenticator through Kiri. Password and federated requests keep the
// engine's own handling.
{
  const credentials = navigator.credentials;
  const PublicKey = window.PublicKeyCredential;
  if (credentials && PublicKey) {
    const nativeCreate = credentials.create.bind(credentials);
    const nativeGet = credentials.get.bind(credentials);
    const AttestationResponse = window.AuthenticatorAttestationResponse;
    const AssertionResponse = window.AuthenticatorAssertionResponse;
    const aborted = (abortSignal) =>
      abortSignal.reason ?? new PageDOMException('The operation was aborted.', 'AbortError');

    const bytesOf = (source) => {
      if (source instanceof ArrayBuffer) return new Uint8Array(source);
      if (ArrayBuffer.isView(source)) return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
      throw new PageTypeError('Expected an ArrayBuffer or a view of one.');
    };
    const encode = (source) => {
      let binary = '';
      for (const byte of bytesOf(source)) binary += String.fromCharCode(byte);
      return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    };
    const decode = (text) => {
      const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4));
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      return bytes.buffer;
    };
    const descriptors = (list) =>
      Array.isArray(list) ? list.map((item) => ({ type: item.type, id: encode(item.id) })) : [];

    const creationJSON = (options) => ({
      challenge: encode(options.challenge),
      rp: { id: options.rp?.id, name: options.rp?.name },
      user: {
        id: encode(options.user?.id),
        name: String(options.user?.name ?? ''),
        displayName: String(options.user?.displayName ?? ''),
      },
      pubKeyCredParams: Array.isArray(options.pubKeyCredParams)
        ? options.pubKeyCredParams.map((item) => ({ type: item.type, alg: item.alg }))
        : [],
      excludeCredentials: descriptors(options.excludeCredentials),
      authenticatorSelection: options.authenticatorSelection && {
        authenticatorAttachment: options.authenticatorSelection.authenticatorAttachment,
        residentKey: options.authenticatorSelection.residentKey,
        requireResidentKey: options.authenticatorSelection.requireResidentKey,
        userVerification: options.authenticatorSelection.userVerification,
      },
      attestation: options.attestation,
    });
    const requestJSON = (options) => ({
      challenge: encode(options.challenge),
      rpId: options.rpId,
      allowCredentials: descriptors(options.allowCredentials),
      userVerification: options.userVerification,
    });

    const methods = (target, values) => {
      for (const [name, value] of Object.entries(values)) Object.defineProperty(target, name, { value });
      return target;
    };
    const fields = (target, values) => {
      for (const [name, value] of Object.entries(values)) {
        Object.defineProperty(target, name, { value, enumerable: true });
      }
      return target;
    };
    const instance = (Type) => (Type ? Object.create(Type.prototype) : {});

    const credential = (reply, response) => {
      const extensions = reply.clientExtensionResults || {};
      const result = fields(instance(PublicKey), {
        id: reply.id,
        rawId: decode(reply.rawId),
        type: 'public-key',
        authenticatorAttachment: reply.authenticatorAttachment ?? null,
        response,
      });
      return methods(result, {
        getClientExtensionResults: () => ({ ...extensions }),
        toJSON: () => ({
          id: reply.id,
          rawId: reply.rawId,
          type: 'public-key',
          authenticatorAttachment: reply.authenticatorAttachment ?? undefined,
          response: reply.response,
          clientExtensionResults: extensions,
        }),
      });
    };
    const attestation = (response) =>
      methods(
        fields(instance(AttestationResponse), {
          clientDataJSON: decode(response.clientDataJSON),
          attestationObject: decode(response.attestationObject),
        }),
        {
          getTransports: () => [...(response.transports || [])],
          getAuthenticatorData: () => (response.authenticatorData ? decode(response.authenticatorData) : null),
          getPublicKey: () => (response.publicKey ? decode(response.publicKey) : null),
          getPublicKeyAlgorithm: () => response.publicKeyAlgorithm ?? null,
        },
      );
    const assertion = (response) =>
      fields(instance(AssertionResponse), {
        clientDataJSON: decode(response.clientDataJSON),
        authenticatorData: decode(response.authenticatorData),
        signature: decode(response.signature),
        userHandle: response.userHandle ? decode(response.userHandle) : null,
      });

    const ceremony = (method, json, abortSignal) =>
      new Promise((resolve, reject) => {
        if (abortSignal?.aborted) {
          reject(aborted(abortSignal));
          return;
        }
        const abort = () => {
          signal('webauthn', 'cancel');
          reject(aborted(abortSignal));
        };
        abortSignal?.addEventListener('abort', abort, { once: true });
        call('webauthn', method, json)
          .then(resolve, reject)
          .finally(() => abortSignal?.removeEventListener('abort', abort));
      });

    credentials.create = function create(options) {
      if (!options || !options.publicKey) return nativeCreate(options);
      let json;
      try {
        json = creationJSON(options.publicKey);
      } catch (error) {
        return Promise.reject(error);
      }
      return ceremony('create', json, options.signal).then((reply) =>
        credential(reply, attestation(reply.response)),
      );
    };
    credentials.get = function get(options) {
      if (!options || !options.publicKey) return nativeGet(options);
      if (options.mediation === 'conditional') {
        return Promise.reject(new PageDOMException('Passkey autofill is not available.', 'NotSupportedError'));
      }
      let json;
      try {
        json = requestJSON(options.publicKey);
      } catch (error) {
        return Promise.reject(error);
      }
      return ceremony('get', json, options.signal).then((reply) =>
        credential(reply, assertion(reply.response)),
      );
    };
    Object.defineProperty(PublicKey, 'isUserVerifyingPlatformAuthenticatorAvailable', {
      value: () => Promise.resolve(true),
      configurable: true,
      writable: true,
    });
    Object.defineProperty(PublicKey, 'isConditionalMediationAvailable', {
      value: () => Promise.resolve(false),
      configurable: true,
      writable: true,
    });
  }
}
