import type { Section, Category } from "./data";

export const apiSections: Section[] = [
  {
    id: "api-overview",
    label: "API Reference",
    category: "overview",
    title: "API Reference",
    prose: [
      "Welcome to the Misty API Reference. This documents the REST API exposed by the Misty local proxy service. The API is the same interface the desktop app uses internally — anything you can do in the app, you can automate through these endpoints.",
      "Base URL: http://localhost:3000 — The proxy runs on your machine. All requests are made to localhost unless you're connecting to a self-hosted instance on another machine.",
      "Authentication: Most endpoints require a valid JWT access token passed in the Authorization header as a Bearer token. Use the /api/login or /api/register endpoints to obtain tokens.",
      "Current version: v0.3.0 — This API is versioned alongside the Misty desktop app. Breaking changes are documented in the changelog.",
    ],
    notes: [
      { kind: "note", text: "This API is not publicly hosted. It runs locally on your machine or on your self-hosted proxy instance." },
      { kind: "tip", text: "Use the Guide section for installation, architecture overview, and getting started. This page is for endpoint-level documentation." },
    ],
  },
  {
    id: "self-hosting",
    label: "Self-Hosting",
    category: "overview",
    title: "Self-Hosting",
    prose: [
      "When you self-host Misty, you run the proxy service on your own infrastructure — a home server, a VPS, or inside your private network. In this setup, the Misty desktop app isn't managing the proxy for you, so you interact with the API directly.",
      "Self-hosting gives you full control over where your data flows. You can lock the proxy behind a VPN, run it on an air-gapped network, or deploy it alongside other services on your homelab. The API is the same one the desktop app uses internally, so everything that works in the app works via the API too.",
      "To get started, deploy the Misty proxy service, register an account via the API, and authenticate. From there you can connect cloud providers, manage devices, and access files — all through HTTP requests.",
    ],
    notes: [
      { kind: "tip", text: "Self-hosting is ideal for homelabs, NAS setups, and teams that need centralized cloud file access without installing the desktop app on every machine." },
      { kind: "note", text: "The proxy requires network access to reach cloud provider APIs (Google, Microsoft, Dropbox). It does not need to be publicly accessible." },
    ],
  },
  {
    id: "authentication",
    label: "Authentication",
    category: "api",
    title: "Authentication",
    description: "Register, log in, and manage JWT tokens. All other API routes require a valid access token in the Authorization header.",
    endpoints: [
      {
        method: "POST", path: "/api/register", desc: "Create a new account",
        curl: `curl -X POST http://localhost:3000/api/register \\
  -H "Content-Type: application/json" \\
  -d '{"name":"Alice","email":"alice@example.com","password":"s3cret"}'`,
        response: `{
  "user": {
    "id": "usr_abc123",
    "name": "Alice",
    "email": "alice@example.com"
  },
  "accessToken": "eyJhbG...",
  "refreshToken": "eyJhbG..."
}`,
      },
      {
        method: "POST", path: "/api/login", desc: "Log in and receive tokens",
        curl: `curl -X POST http://localhost:3000/api/login \\
  -H "Content-Type: application/json" \\
  -d '{"email":"alice@example.com","password":"s3cret"}'`,
        response: `{
  "accessToken": "eyJhbG...",
  "refreshToken": "eyJhbG..."
}`,
      },
      {
        method: "POST", path: "/api/logout", desc: "Log out and revoke tokens",
        curl: `curl -X POST http://localhost:3000/api/logout \\
  -H "Authorization: Bearer <accessToken>"`,
        response: `{ "message": "Logged out" }`,
      },
      {
        method: "POST", path: "/api/refresh", desc: "Refresh an access token",
        curl: `curl -X POST http://localhost:3000/api/refresh \\
  -H "Content-Type: application/json" \\
  -d '{"refreshToken":"eyJhbG..."}'`,
        response: `{ "accessToken": "eyJhbG..." }`,
      },
    ],
  },
  {
    id: "devices",
    label: "Devices",
    category: "api",
    title: "Devices",
    badge: "Auth",
    description: "Create, read, update, and delete registered devices.",
    endpoints: [
      {
        method: "GET", path: "/api/devices", desc: "List all devices",
        curl: `curl http://localhost:3000/api/devices \\
  -H "Authorization: Bearer <accessToken>"`,
        response: `[
  {
    "id": "dev_001",
    "name": "MacBook Pro",
    "os": "darwin",
    "lastSeen": "2025-06-01T12:00:00Z"
  }
]`,
      },
      {
        method: "POST", path: "/api/devices", desc: "Register a device",
        curl: `curl -X POST http://localhost:3000/api/devices \\
  -H "Authorization: Bearer <accessToken>" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"Desktop","os":"linux"}'`,
        response: `{
  "id": "dev_002",
  "name": "Desktop",
  "os": "linux",
  "lastSeen": "2025-06-01T12:05:00Z"
}`,
      },
      {
        method: "PUT", path: "/api/devices", desc: "Update a device",
        curl: `curl -X PUT http://localhost:3000/api/devices \\
  -H "Authorization: Bearer <accessToken>" \\
  -H "Content-Type: application/json" \\
  -d '{"id":"dev_002","name":"Work Desktop"}'`,
        response: `{
  "id": "dev_002",
  "name": "Work Desktop",
  "os": "linux",
  "lastSeen": "2025-06-01T12:10:00Z"
}`,
      },
      {
        method: "DELETE", path: "/api/devices", desc: "Remove a device",
        curl: `curl -X DELETE http://localhost:3000/api/devices \\
  -H "Authorization: Bearer <accessToken>" \\
  -H "Content-Type: application/json" \\
  -d '{"id":"dev_002"}'`,
        response: `{ "message": "Device removed" }`,
      },
    ],
  },
  {
    id: "workspaces",
    label: "Workspaces",
    category: "api",
    title: "Workspaces",
    badge: "Auth",
    description: "Manage workspaces for organizing files and folders across providers.",
    endpoints: [
      {
        method: "GET", path: "/api/workspaces", desc: "List all workspaces",
        curl: `curl http://localhost:3000/api/workspaces \\
  -H "Authorization: Bearer <accessToken>"`,
        response: `[
  { "id": "ws_01", "name": "Personal", "createdAt": "2025-05-20T09:00:00Z" },
  { "id": "ws_02", "name": "Work", "createdAt": "2025-05-21T10:00:00Z" }
]`,
      },
      {
        method: "GET", path: "/api/workspace", desc: "Get a single workspace",
        curl: `curl http://localhost:3000/api/workspace?id=ws_01 \\
  -H "Authorization: Bearer <accessToken>"`,
        response: `{
  "id": "ws_01",
  "name": "Personal",
  "createdAt": "2025-05-20T09:00:00Z",
  "providers": ["google-drive", "dropbox"]
}`,
      },
      {
        method: "POST", path: "/api/workspaces", desc: "Create a workspace",
        curl: `curl -X POST http://localhost:3000/api/workspaces \\
  -H "Authorization: Bearer <accessToken>" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"Projects"}'`,
        response: `{
  "id": "ws_03",
  "name": "Projects",
  "createdAt": "2025-06-01T14:00:00Z"
}`,
      },
      {
        method: "PUT", path: "/api/workspaces", desc: "Update a workspace",
        curl: `curl -X PUT http://localhost:3000/api/workspaces \\
  -H "Authorization: Bearer <accessToken>" \\
  -H "Content-Type: application/json" \\
  -d '{"id":"ws_03","name":"Side Projects"}'`,
        response: `{ "id": "ws_03", "name": "Side Projects" }`,
      },
      {
        method: "DELETE", path: "/api/workspaces", desc: "Delete a workspace",
        curl: `curl -X DELETE http://localhost:3000/api/workspaces \\
  -H "Authorization: Bearer <accessToken>" \\
  -H "Content-Type: application/json" \\
  -d '{"id":"ws_03"}'`,
        response: `{ "message": "Workspace deleted" }`,
      },
    ],
  },
  {
    id: "tailscale",
    label: "Tailscale",
    category: "api",
    title: "Tailscale",
    badge: "Auth",
    description: "Query your Tailscale network status, list peers, and ping nodes.",
    endpoints: [
      {
        method: "GET", path: "/api/ts-status", desc: "Get Tailscale status",
        curl: `curl http://localhost:3000/api/ts-status \\
  -H "Authorization: Bearer <accessToken>"`,
        response: `{
  "backendState": "Running",
  "self": { "hostName": "macbook", "tailscaleIP": "100.64.0.1" }
}`,
      },
      {
        method: "GET", path: "/api/ts-peers", desc: "List Tailscale peers",
        curl: `curl http://localhost:3000/api/ts-peers \\
  -H "Authorization: Bearer <accessToken>"`,
        response: `[
  { "hostName": "desktop", "tailscaleIP": "100.64.0.2", "online": true },
  { "hostName": "phone", "tailscaleIP": "100.64.0.3", "online": false }
]`,
      },
      {
        method: "GET", path: "/api/ts-ping", desc: "Ping a Tailscale peer",
        curl: `curl "http://localhost:3000/api/ts-ping?ip=100.64.0.2" \\
  -H "Authorization: Bearer <accessToken>"`,
        response: `{
  "ip": "100.64.0.2",
  "latency": "12ms",
  "pong": true
}`,
      },
    ],
  },
  {
    id: "onedrive",
    label: "OneDrive",
    category: "api",
    title: "OneDrive (Microsoft)",
    badge: "Pro",
    description: "Authenticate with Microsoft, browse OneDrive files, and manage uploads and downloads.",
    endpoints: [
      { method: "GET", path: "/api/ms/auth", desc: "Start Microsoft OAuth flow",
        curl: `curl http://localhost:3000/api/ms/auth`,
        response: `{ "redirectUrl": "https://login.microsoftonline.com/..." }` },
      { method: "GET", path: "/api/ms/users", desc: "List connected Microsoft accounts",
        curl: `curl http://localhost:3000/api/ms/users \\
  -H "Authorization: Bearer <accessToken>"`,
        response: `[{ "id": "ms_u1", "email": "alice@outlook.com", "displayName": "Alice" }]` },
      { method: "DELETE", path: "/api/ms/users", desc: "Disconnect a Microsoft account",
        curl: `curl -X DELETE http://localhost:3000/api/ms/users \\
  -H "Authorization: Bearer <accessToken>" \\
  -d '{"id":"ms_u1"}'`,
        response: `{ "message": "Account disconnected" }` },
      { method: "GET", path: "/api/ms/drive", desc: "Get drive info",
        curl: `curl http://localhost:3000/api/ms/drive \\
  -H "Authorization: Bearer <accessToken>"`,
        response: `{ "id": "drv_1", "type": "personal", "quota": { "used": 1073741824, "total": 5368709120 } }` },
      { method: "GET", path: "/api/ms/drive/root", desc: "Get drive root",
        curl: `curl http://localhost:3000/api/ms/drive/root \\
  -H "Authorization: Bearer <accessToken>"`,
        response: `{ "id": "root", "name": "root", "folder": { "childCount": 12 } }` },
      { method: "GET", path: "/api/ms/files", desc: "List files in a folder",
        curl: `curl "http://localhost:3000/api/ms/files?folderId=root" \\
  -H "Authorization: Bearer <accessToken>"`,
        response: `[{ "id": "f1", "name": "report.pdf", "size": 204800 }]` },
      { method: "GET", path: "/api/ms/file", desc: "Get file metadata",
        curl: `curl "http://localhost:3000/api/ms/file?id=f1" \\
  -H "Authorization: Bearer <accessToken>"`,
        response: `{ "id": "f1", "name": "report.pdf", "size": 204800, "mimeType": "application/pdf" }` },
      { method: "GET", path: "/api/ms/file/download", desc: "Download a file",
        curl: `curl -O "http://localhost:3000/api/ms/file/download?id=f1" \\
  -H "Authorization: Bearer <accessToken>"`,
        response: `<binary file data>` },
      { method: "POST", path: "/api/ms/file/upload", desc: "Upload a file",
        curl: `curl -X POST http://localhost:3000/api/ms/file/upload \\
  -H "Authorization: Bearer <accessToken>" \\
  -F "file=@report.pdf" -F "folderId=root"`,
        response: `{ "id": "f2", "name": "report.pdf", "size": 204800 }` },
      { method: "POST", path: "/api/ms/folder/create", desc: "Create a folder",
        curl: `curl -X POST http://localhost:3000/api/ms/folder/create \\
  -H "Authorization: Bearer <accessToken>" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"New Folder","parentId":"root"}'`,
        response: `{ "id": "fld_1", "name": "New Folder" }` },
    ],
  },
  {
    id: "google-drive",
    label: "Google Drive",
    category: "api",
    title: "Google Drive",
    badge: "Pro",
    description: "Authenticate with Google, browse Drive files, and manage uploads and downloads.",
    endpoints: [
      { method: "GET", path: "/api/gd/auth", desc: "Start Google OAuth flow",
        curl: `curl http://localhost:3000/api/gd/auth`,
        response: `{ "redirectUrl": "https://accounts.google.com/o/oauth2/..." }` },
      { method: "GET", path: "/api/gd/users", desc: "List connected Google accounts",
        curl: `curl http://localhost:3000/api/gd/users \\
  -H "Authorization: Bearer <accessToken>"`,
        response: `[{ "id": "gd_u1", "email": "alice@gmail.com", "displayName": "Alice" }]` },
      { method: "DELETE", path: "/api/gd/users", desc: "Disconnect a Google account",
        curl: `curl -X DELETE http://localhost:3000/api/gd/users \\
  -H "Authorization: Bearer <accessToken>" \\
  -d '{"id":"gd_u1"}'`,
        response: `{ "message": "Account disconnected" }` },
      { method: "GET", path: "/api/gd/drive", desc: "Get drive info",
        curl: `curl http://localhost:3000/api/gd/drive \\
  -H "Authorization: Bearer <accessToken>"`,
        response: `{ "id": "drv_g1", "name": "My Drive", "quota": { "used": 2147483648, "total": 16106127360 } }` },
      { method: "GET", path: "/api/gd/drive/root", desc: "Get drive root",
        curl: `curl http://localhost:3000/api/gd/drive/root \\
  -H "Authorization: Bearer <accessToken>"`,
        response: `{ "id": "root", "name": "My Drive", "mimeType": "application/vnd.google-apps.folder" }` },
      { method: "GET", path: "/api/gd/files", desc: "List files in a folder",
        curl: `curl "http://localhost:3000/api/gd/files?folderId=root" \\
  -H "Authorization: Bearer <accessToken>"`,
        response: `[{ "id": "gf1", "name": "notes.docx", "size": 51200 }]` },
      { method: "GET", path: "/api/gd/file", desc: "Get file metadata",
        curl: `curl "http://localhost:3000/api/gd/file?id=gf1" \\
  -H "Authorization: Bearer <accessToken>"`,
        response: `{ "id": "gf1", "name": "notes.docx", "size": 51200, "mimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }` },
      { method: "GET", path: "/api/gd/file/download", desc: "Download a file",
        curl: `curl -O "http://localhost:3000/api/gd/file/download?id=gf1" \\
  -H "Authorization: Bearer <accessToken>"`,
        response: `<binary file data>` },
      { method: "POST", path: "/api/gd/file/upload", desc: "Upload a file",
        curl: `curl -X POST http://localhost:3000/api/gd/file/upload \\
  -H "Authorization: Bearer <accessToken>" \\
  -F "file=@notes.docx" -F "folderId=root"`,
        response: `{ "id": "gf2", "name": "notes.docx", "size": 51200 }` },
      { method: "POST", path: "/api/gd/folder/create", desc: "Create a folder",
        curl: `curl -X POST http://localhost:3000/api/gd/folder/create \\
  -H "Authorization: Bearer <accessToken>" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"Archive","parentId":"root"}'`,
        response: `{ "id": "gfld_1", "name": "Archive" }` },
    ],
  },
  {
    id: "dropbox",
    label: "Dropbox",
    category: "api",
    title: "Dropbox",
    badge: "Pro",
    description: "Authenticate with Dropbox, browse files, and manage uploads and downloads.",
    endpoints: [
      { method: "GET", path: "/api/dbx/auth", desc: "Start Dropbox OAuth flow",
        curl: `curl http://localhost:3000/api/dbx/auth`,
        response: `{ "redirectUrl": "https://www.dropbox.com/oauth2/authorize?..." }` },
      { method: "GET", path: "/api/dbx/users", desc: "List connected Dropbox accounts",
        curl: `curl http://localhost:3000/api/dbx/users \\
  -H "Authorization: Bearer <accessToken>"`,
        response: `[{ "id": "dbx_u1", "email": "alice@dropbox.com", "displayName": "Alice" }]` },
      { method: "DELETE", path: "/api/dbx/users", desc: "Disconnect a Dropbox account",
        curl: `curl -X DELETE http://localhost:3000/api/dbx/users \\
  -H "Authorization: Bearer <accessToken>" \\
  -d '{"id":"dbx_u1"}'`,
        response: `{ "message": "Account disconnected" }` },
      { method: "GET", path: "/api/dbx/drive", desc: "Get drive info",
        curl: `curl http://localhost:3000/api/dbx/drive \\
  -H "Authorization: Bearer <accessToken>"`,
        response: `{ "id": "drv_d1", "name": "Dropbox", "quota": { "used": 536870912, "total": 2147483648 } }` },
      { method: "GET", path: "/api/dbx/drive/root", desc: "Get drive root",
        curl: `curl http://localhost:3000/api/dbx/drive/root \\
  -H "Authorization: Bearer <accessToken>"`,
        response: `{ "id": "root", "name": "", "path": "/" }` },
      { method: "GET", path: "/api/dbx/files", desc: "List files in a folder",
        curl: `curl "http://localhost:3000/api/dbx/files?path=/" \\
  -H "Authorization: Bearer <accessToken>"`,
        response: `[{ "id": "dbf1", "name": "photo.jpg", "size": 1048576 }]` },
      { method: "GET", path: "/api/dbx/file", desc: "Get file metadata",
        curl: `curl "http://localhost:3000/api/dbx/file?id=dbf1" \\
  -H "Authorization: Bearer <accessToken>"`,
        response: `{ "id": "dbf1", "name": "photo.jpg", "size": 1048576, "mimeType": "image/jpeg" }` },
      { method: "GET", path: "/api/dbx/file/download", desc: "Download a file",
        curl: `curl -O "http://localhost:3000/api/dbx/file/download?id=dbf1" \\
  -H "Authorization: Bearer <accessToken>"`,
        response: `<binary file data>` },
      { method: "POST", path: "/api/dbx/file/upload", desc: "Upload a file",
        curl: `curl -X POST http://localhost:3000/api/dbx/file/upload \\
  -H "Authorization: Bearer <accessToken>" \\
  -F "file=@photo.jpg" -F "path=/"`,
        response: `{ "id": "dbf2", "name": "photo.jpg", "size": 1048576 }` },
      { method: "POST", path: "/api/dbx/folder/create", desc: "Create a folder",
        curl: `curl -X POST http://localhost:3000/api/dbx/folder/create \\
  -H "Authorization: Bearer <accessToken>" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"Backups","path":"/"}'`,
        response: `{ "id": "dbfld_1", "name": "Backups" }` },
    ],
  },
];

export const apiCategories: Category[] = [
  { key: "overview", label: "Overview", ids: ["api-overview", "self-hosting"] },
  { key: "core", label: "Core", ids: ["authentication", "devices", "workspaces", "tailscale"] },
  { key: "services", label: "Services", ids: ["onedrive", "google-drive", "dropbox"] },
];