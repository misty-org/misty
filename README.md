# Misty

Misty is an experimental distributed file system project. It combines a
minimal gRPC-based DFS core written in C++ with a Go-based proxy service for
API access and Tailscale-aware networking.

## Components

- `minidfs/`: C++20 MiniDFS server, ImGui desktop client, and shared library.
  See `minidfs/README.md` for build/run details.
- `proxy/`: Go API service with SQLite-backed user/file endpoints and
  Tailscale status/peer helpers. See `proxy/README.md` for setup.

## Repository Layout

- `minidfs/` - main DFS implementation (server, client, tests)
- `proxy/` - API and networking proxy layer
- `proto/` - shared protobuf definitions
- `scripts/` - vendor/bootstrap helpers
- `vendor/` - third-party dependencies

