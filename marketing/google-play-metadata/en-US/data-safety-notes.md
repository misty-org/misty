# Google Play Data Safety Notes Draft

Google Play requires developers to complete the Data safety form and keep declarations accurate for all distributed versions of the package.

## Likely Declarations To Confirm

- Data is encrypted in transit: yes, for HTTPS-backed account/provider communication.
- Account management: Misty account sign-in is used for account/session state.
- Files and docs: users may browse file names, paths, metadata, and selected file contents through Misty workflows.
- App activity/diagnostics: declare only if production diagnostics sharing is enabled for Android.
- Device or other IDs: no advertising ID use is expected in this local build.
- Data sharing: confirm with the owner based on production API/provider processing.
- Account deletion: supply the production deletion or support request process before submission.

## Local Evidence

- The packaged Android app requests `android.permission.INTERNET` plus Android's package-scoped dynamic-receiver permission. It requests no storage, package-query, install, advertising-ID, or biometric permission.
- Mobile auth tokens use AES-256-GCM with an app-only key held in `AndroidKeyStore`; only ciphertext and an IV are stored in app-private preferences.
- Mobile release scans check for purchase language, desktop extension UI, debug panels, and high-confidence secrets.

Final Data safety answers must be reviewed by the app owner against production backend behavior and any third-party SDKs enabled for the Play build.
