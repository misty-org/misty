import LocalAuthentication
import SwiftRs
import Tauri
import UIKit
import WebKit

class StoreRequest: Decodable {
  let value: String
}

class KeystorePlugin: Plugin {
  private let account = "com.misty.mobile.auth.v2"
  private let legacyAccount = "com.impierce.identity-wallet.unime-dev"

  @objc public func store(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(StoreRequest.self)
    guard let secretData = args.value.data(using: .utf8) else {
      throw NSError(domain: "MistyKeystore", code: -1)
    }

    try storeSecret(secretData, account: account)
    try? deleteSecret(account: legacyAccount)
    invoke.resolve()
  }

  @objc public func retrieve(_ invoke: Invoke) throws {
    if let secret = try retrieveSecret(account: account, context: nil) {
      invoke.resolve(["value": secret])
      return
    }

    // Earlier mobile builds protected the API token with userPresence. That
    // produced a passcode/Face ID sheet for every concurrent cold-start read.
    // Ask once for the legacy value, then move it to device-bound storage that
    // remains available to the signed-in app without another UI prompt.
    let context = LAContext()
    context.localizedReason = "Access your Misty account"
    guard let secret = try retrieveSecret(account: legacyAccount, context: context) else {
      throw NSError(domain: NSOSStatusErrorDomain, code: Int(errSecItemNotFound))
    }
    guard let secretData = secret.data(using: .utf8) else {
      throw NSError(domain: "MistyKeystore", code: -1)
    }
    try storeSecret(secretData, account: account)
    try? deleteSecret(account: legacyAccount)
    invoke.resolve(["value": secret])
  }

  @objc public func remove(_ invoke: Invoke) throws {
    try deleteSecret(account: account)
    try deleteSecret(account: legacyAccount)
    invoke.resolve()
  }

  private func retrieveSecret(account: String, context: LAContext?) throws -> String? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrAccount as String: account,
      kSecReturnData as String: true
    ]
    var authenticatedQuery = query
    if let context {
      authenticatedQuery[kSecUseAuthenticationContext as String] = context
    }
    var item: CFTypeRef?
    let status = SecItemCopyMatching(authenticatedQuery as CFDictionary, &item)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess else {
      throw NSError(domain: NSOSStatusErrorDomain, code: Int(status))
    }
    guard let data = item as? Data, let secret = String(data: data, encoding: .utf8) else {
      throw NSError(domain: "MistyKeystore", code: -1)
    }
    return secret
  }

  private func storeSecret(_ secretData: Data, account: String) throws {
    let lookup: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrAccount as String: account
    ]
    let deleteStatus = SecItemDelete(lookup as CFDictionary)
    guard deleteStatus == errSecSuccess || deleteStatus == errSecItemNotFound else {
      throw NSError(domain: NSOSStatusErrorDomain, code: Int(deleteStatus))
    }

    var query = lookup
    query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    query[kSecValueData as String] = secretData
    let status = SecItemAdd(query as CFDictionary, nil)
    guard status == errSecSuccess else {
      throw NSError(domain: NSOSStatusErrorDomain, code: Int(status))
    }
  }

  private func deleteSecret(account: String) throws {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrAccount as String: account
    ]
    let status = SecItemDelete(query as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else {
      throw NSError(domain: NSOSStatusErrorDomain, code: Int(status))
    }
  }
}

@_cdecl("init_plugin_keystore")
func initPlugin() -> Plugin {
  KeystorePlugin()
}
