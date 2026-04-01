# Misty storage engine provenance

- Upstream project: rclone
- Upstream release: `v1.74.4`
- Upstream commit: `5bc93a2a7ab0ebd0a11352bc4968eabeffb18027`
- Upstream tag object: `730b5ffe66e2e1947a834ed747f5d1d107306939`
- Source retrieved from: `https://github.com/rclone/rclone`
- Build entrypoint: `./librclone`
- Compiled backends: Google Drive (`drive`), Dropbox (`dropbox`), OneDrive/SharePoint (`onedrive`), and local filesystem (`local`)
- Compiled RC groups: `operations/*`, `sync/*`, core configuration, jobs, and accounting
- Intentionally excluded: the all-backends registry, mount commands, dynamic plugins, CLI server, and unsupported storage backends

## Misty patch set

Misty carries private product integration changes in:

- `backend/drive/drive.go`
- `backend/dropbox/dropbox.go`
- `backend/onedrive/onedrive.go`
- `lib/oauthutil/oauthutil.go`

Updates must start from a stable upstream tag, reapply this patch set, pass the Core 3 provider matrix, and be reviewed before replacing this pinned source. Misty does not automatically follow upstream `master`.
