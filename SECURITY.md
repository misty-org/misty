# Security

## Reporting a vulnerability

Please report security problems privately, never in a public issue, pull request or Discord
channel. Email **security@mistysys.com** or use GitHub's private vulnerability reporting on this
repository (Security › Report a vulnerability).

Include what you found, the steps to reproduce it, the version or commit you tested, and the
impact you expect. We will acknowledge the report and keep you informed until it is fixed. Please give us a reasonable time to ship a fix before you disclose it.

## Scope

In scope: the desktop app (`src/`, `src-tauri/`, `kiri/`), the `misty` CLI (`cli/`) and the server
(`server/`), including sync encryption, device admission, agent permissions and the browser's
handling of untrusted pages.

Out of scope: findings that need an already compromised device or account, social engineering,
and denial of service through volume alone.
