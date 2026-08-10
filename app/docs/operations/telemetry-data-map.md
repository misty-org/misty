# Telemetry and crash data map

Remote telemetry is off by default. Usage analytics and error reporting have
separate user-controlled preferences, persisted locally and on the account.
Development and tests never send PostHog events.

When usage analytics is enabled, Misty may send the allowlisted event name and
coarse client metadata: platform, OS/app version, architecture, release and
distribution channel, device class, and environment. Identity is synchronized
only while analytics is enabled.

When error reporting is enabled, Misty may send a redacted error name/message,
redacted stack, safe operation category, runtime layer, and the same coarse
client metadata. Automatic page, click, dead-click, performance, session
recording, survey, and exception capture are disabled in the PostHog client.

Redaction removes or replaces:

- authorization, cookie, password, secret, token, email, name, path, file,
  folder, query, clipboard, content, body, and URL fields
- email-like values, bearer/token-like values, local paths, filenames, and
  non-asset URLs in messages and stacks

Journal contents, Library file bytes, filenames, prompts, clipboard contents,
OAuth credentials, passwords, presigned URLs, and payment credentials are not
valid telemetry fields. The locally generated support bundle applies the same
redaction and is never uploaded automatically.

The release owner must set the production project region and retention, publish
those values in the Privacy Policy/subprocessor notice, and verify them after
every telemetry-provider configuration change.
