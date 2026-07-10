# Android Security Audit

Generated: 2026-07-09T23:38:01.246Z

## Passes
- high-confidence secret formats: no hits
- Play policy and desktop-only mobile bundle strings: no hits
- src-tauri/gen/android/app/src/main/AndroidManifest.xml: INTERNET permission only baseline
- src-tauri/gen/android/app/src/main/AndroidManifest.xml: no broad Android runtime permissions
- src-tauri/gen/android/app/build.gradle.kts: Android applicationId com.misty.mobile
- src-tauri/gen/android/app/build.gradle.kts: Android namespace com.misty.mobile
- src-tauri/gen/android/app/build.gradle.kts: release cleartext traffic disabled
- src-tauri/gen/android/app/build.gradle.kts: release signing env preflight
- src-tauri/Cargo.toml: repo-owned Android secure storage plugin
- src-tauri/vendor/tauri-plugin-keystore/android/src/main/java/SecureTokenStore.kt: Android Keystore-backed auth token key
- src-tauri/vendor/tauri-plugin-keystore/android/src/main/java/SecureTokenStore.kt: AES-GCM auth token encryption
- src-tauri/vendor/tauri-plugin-keystore/android/build.gradle.kts: no unnecessary biometric dependency or permission
- src-tauri/vendor/tauri-plugin-keystore/android/src/main/java/KeystorePlugin.kt: no unnecessary biometric access or sensitive native debug logging
- src-tauri/vendor/tauri-plugin-keystore/android/src/main/java/SecureTokenStore.kt: no unnecessary biometric access or sensitive native debug logging
- src-tauri/vendor/tauri-plugin-keystore/android/src/androidTest/java/SecureTokenStoreTest.kt: Android secure storage instrumentation coverage
- src/pages/Extensions/mobile/index.tsx: mobile Extensions redirect
- src/router.tsx: mobile desktop-only route redirects
- src/stores/useSettingsStore.ts: mobile avoids localhost advanced server fallback
- marketing/google-play-metadata/en-US/play-store-listing.json: no placeholder or fake Google Play metadata URL values

## Warnings
- None.

## Findings
- No critical or high-severity local Android findings in this automated pass.
