# Misty storage engine provenance

- Upstream project: rclone
- Upstream release: `v1.74.4`
- Upstream commit: `5bc93a2a7ab0ebd0a11352bc4968eabeffb18027`
- Upstream tag object: `730b5ffe66e2e1947a834ed747f5d1d107306939`
- Source: `service/rclone` submodule from `https://github.com/rclone/rclone`
- Build entrypoint after patching: `./librclone`
- Compiled backends: Google Drive, Dropbox, OneDrive/SharePoint, and local
- Compiled RC groups: operations, sync, configuration, jobs, and accounting

## Misty patch set

`patches/0001-misty-integration.patch` changes only:

- `backend/drive/drive.go`
- `backend/dropbox/dropbox.go`
- `backend/onedrive/onedrive.go`
- `lib/oauthutil/oauthutil.go`
- `librclone/librclone.go`

Updates must start from a stable upstream tag, regenerate the patch against
that revision, pass the Core 3 provider matrix, and receive review before the
submodule pointer changes. Misty does not automatically follow upstream.
