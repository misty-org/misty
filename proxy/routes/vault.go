package routes

func VaultRoutes() []Route {
	return []Route{
		{Method: "GET", Path: "/vault/health", Group: "vault", AuthRequired: true},
		{Method: "GET", Path: "/vault/repos", Group: "vault", AuthRequired: true},
		{Method: "POST", Path: "/vault/repos", Group: "vault", AuthRequired: true},
		{Method: "DELETE", Path: "/vault/repos", Group: "vault", AuthRequired: true},
		{Method: "GET", Path: "/vault/repos/stats", Group: "vault", AuthRequired: true},
		{Method: "POST", Path: "/vault/repos/check", Group: "vault", AuthRequired: true},
		{Method: "POST", Path: "/vault/repos/unlock", Group: "vault", AuthRequired: true},
		{Method: "GET", Path: "/vault/snapshots", Group: "vault", AuthRequired: true},
		{Method: "GET", Path: "/vault/snapshots/files", Group: "vault", AuthRequired: true},
		{Method: "POST", Path: "/vault/backup", Group: "vault", AuthRequired: true},
		{Method: "POST", Path: "/vault/restore", Group: "vault", AuthRequired: true},
		{Method: "POST", Path: "/vault/forget", Group: "vault", AuthRequired: true},
		{Method: "GET", Path: "/vault/jobs", Group: "vault", AuthRequired: true},
		{Method: "GET", Path: "/vault/jobs/{id}", Group: "vault", AuthRequired: true},
		{Method: "GET", Path: "/vault/jobs/{id}/stream", Group: "vault", AuthRequired: true},
		{Method: "POST", Path: "/vault/jobs/{id}/cancel", Group: "vault", AuthRequired: true},
	}
}
