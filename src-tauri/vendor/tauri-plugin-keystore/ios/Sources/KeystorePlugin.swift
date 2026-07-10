import LocalAuthentication
import SwiftRs
import Tauri
import UIKit
import WebKit

class StoreRequest: Decodable {
  let value: String
}

class KeystorePlugin: Plugin {
  private let account = "com.impierce.identity-wallet.unime-dev"

  @objc public func store(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(StoreRequest.self)
    guard let secretData = args.value.data(using: .utf8) else {
      throw NSError(domain: "MistyKeystore", code: -1)
    }

    var error: Unmanaged<CFError>?
    guard let accessControl = SecAccessControlCreateWithFlags(
      nil,
      kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
      .userPresence,
      &error
    ) else {
      throw error!.takeRetainedValue() as Error
    }

    let lookup: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrAccount as String: account
    ]
    SecItemDelete(lookup as CFDictionary)

    var query = lookup
    query[kSecAttrAccessControl as String] = accessControl
    query[kSecValueData as String] = secretData
    let status = SecItemAdd(query as CFDictionary, nil)
    guard status == errSecSuccess else {
      throw NSError(domain: NSOSStatusErrorDomain, code: Int(status))
    }
    invoke.resolve()
  }

  @objc public func retrieve(_ invoke: Invoke) throws {
    let context = LAContext()
    context.localizedReason = "Access your Misty account"
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrAccount as String: account,
      kSecReturnData as String: true,
      kSecUseAuthenticationContext as String: context
    ]
    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    guard status == errSecSuccess else {
      throw NSError(domain: NSOSStatusErrorDomain, code: Int(status))
    }
    guard let data = item as? Data, let secret = String(data: data, encoding: .utf8) else {
      throw NSError(domain: "MistyKeystore", code: -1)
    }
    invoke.resolve(["value": secret])
  }

  @objc public func remove(_ invoke: Invoke) throws {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrAccount as String: account
    ]
    let status = SecItemDelete(query as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else {
      throw NSError(domain: NSOSStatusErrorDomain, code: Int(status))
    }
    invoke.resolve()
  }
}

@_cdecl("init_plugin_keystore")
func initPlugin() -> Plugin {
  KeystorePlugin()
}
