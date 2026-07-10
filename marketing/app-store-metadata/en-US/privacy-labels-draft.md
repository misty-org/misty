# App Privacy Labels Draft

This is a submission planning draft. Confirm with production backend behavior and legal/privacy review before entering labels in App Store Connect.

## Data Potentially Collected Or Used

Contact Info:

- Email address and display name for Misty account sign-in.

User Content:

- File and folder metadata that the user chooses to browse or transfer.
- Provider configuration metadata needed to connect supported storage services.

Identifiers:

- Device/account identifiers needed for account state and local runtime coordination.

Diagnostics:

- Optional diagnostics if the user enables diagnostics sharing.

## Data Not Used For Tracking

Misty iOS should not use collected data to track users across apps or websites owned by other companies.

## Sensitive Handling Notes

- Provider secrets and auth tokens must not be logged.
- Account auth tokens are stored through the device keystore path.
- Sign-out must clear local account state.
- Extension/plugin dynamic code execution is intentionally unavailable on mobile.

## Permissions

Local Network:

- Purpose string: "Misty uses local secure runtime services on this device to browse and transfer files."

URL Scheme:

- `misty` is used for auth/deep-link returns.

## Binary Privacy Manifest

Bundled file: `src-tauri/gen/apple/misty-desktop_iOS/PrivacyInfo.xcprivacy`

Tracking:

- `NSPrivacyTracking=false`
- `NSPrivacyTrackingDomains=[]`

Declared collected data types:

- Email address, linked to the user, App Functionality.
- Name, linked to the user, App Functionality.
- User ID, linked to the user, App Functionality.
- Other user content, linked to the user, App Functionality.
- Crash data, not linked, App Functionality.
- Performance data, not linked, App Functionality.

Declared required-reason API categories:

- File timestamps: `C617.1`
- Disk space: `E174.1`
- System boot time: `35F9.1`
- User defaults: `CA92.1`

Generate Xcode's privacy report from the final signed archive and reconcile it with these draft App Store privacy labels before submission.

## Export Compliance

The current iOS Info.plist sets `ITSAppUsesNonExemptEncryption=false`. Revisit this answer before every submission if encryption behavior changes beyond standard platform/network encryption.
