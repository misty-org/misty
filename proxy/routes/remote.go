package routes

const (
	RemoteBasePath       = "/remote"
	LegacyRemoteBasePath = "/remotes"
)

func RemoteRoutes() []Route {
	return []Route{
		{Method: "GET", Path: RemoteBasePath + "/health", Group: "remote"},
		{Method: "GET", Path: RemoteBasePath, Group: "remote", AuthRequired: true},
		{Method: "DELETE", Path: RemoteBasePath, Group: "remote", AuthRequired: true},
		{Method: "GET", Path: RemoteBasePath + "/types", Group: "remote", AuthRequired: true},
		{Method: "GET", Path: RemoteBasePath + "/workflows", Group: "remote", AuthRequired: true},
		{Method: "GET", Path: RemoteBasePath + "/workflow", Group: "remote", AuthRequired: true},
		{Method: "GET", Path: RemoteBasePath + "/status", Group: "remote", AuthRequired: true},
		{Method: "POST", Path: RemoteBasePath + "/config/start", Group: "remote", AuthRequired: true},
		{Method: "POST", Path: RemoteBasePath + "/config/continue", Group: "remote", AuthRequired: true},
		{Method: "POST", Path: RemoteBasePath + "/config/reconnect", Group: "remote", AuthRequired: true},
		{Method: "POST", Path: RemoteBasePath + "/config/repair", Group: "remote", AuthRequired: true},
		{Method: "GET", Path: RemoteBasePath + "/health", Group: "remote", AuthRequired: true},
		{Method: "GET", Path: RemoteBasePath + "/file/list", Group: "remote", AuthRequired: true},
		{Method: "GET", Path: RemoteBasePath + "/file/download", Group: "remote", AuthRequired: true},
		{Method: "POST", Path: RemoteBasePath + "/file/upload", Group: "remote", AuthRequired: true},
		{Method: "DELETE", Path: RemoteBasePath + "/file", Group: "remote", AuthRequired: true},
		{Method: "POST", Path: RemoteBasePath + "/file/rename", Group: "remote", AuthRequired: true},
		{Method: "GET", Path: LegacyRemoteBasePath, Group: "remote", AuthRequired: true},
		{Method: "DELETE", Path: LegacyRemoteBasePath, Group: "remote", AuthRequired: true},
		{Method: "GET", Path: LegacyRemoteBasePath + "/types", Group: "remote", AuthRequired: true},
		{Method: "GET", Path: LegacyRemoteBasePath + "/workflows", Group: "remote", AuthRequired: true},
		{Method: "GET", Path: LegacyRemoteBasePath + "/workflow", Group: "remote", AuthRequired: true},
		{Method: "GET", Path: LegacyRemoteBasePath + "/status", Group: "remote", AuthRequired: true},
		{Method: "POST", Path: LegacyRemoteBasePath + "/config/start", Group: "remote", AuthRequired: true},
		{Method: "POST", Path: LegacyRemoteBasePath + "/config/continue", Group: "remote", AuthRequired: true},
		{Method: "POST", Path: LegacyRemoteBasePath + "/config/reconnect", Group: "remote", AuthRequired: true},
		{Method: "POST", Path: LegacyRemoteBasePath + "/config/repair", Group: "remote", AuthRequired: true},
		{Method: "GET", Path: LegacyRemoteBasePath + "/health", Group: "remote"},
		{Method: "GET", Path: LegacyRemoteBasePath + "/health", Group: "remote", AuthRequired: true},
		{Method: "GET", Path: LegacyRemoteBasePath + "/file/list", Group: "remote", AuthRequired: true},
		{Method: "GET", Path: LegacyRemoteBasePath + "/file/download", Group: "remote", AuthRequired: true},
		{Method: "POST", Path: LegacyRemoteBasePath + "/file/upload", Group: "remote", AuthRequired: true},
		{Method: "DELETE", Path: LegacyRemoteBasePath + "/file", Group: "remote", AuthRequired: true},
		{Method: "POST", Path: LegacyRemoteBasePath + "/file/rename", Group: "remote", AuthRequired: true},
	}
}
