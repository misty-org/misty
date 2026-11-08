# api

The neutral transport. Nothing here belongs to one feature; each feature keeps its own server
calls in its `api/` folder (or an `api.ts`) and builds them on this layer.

| Folder | Holds |
| --- | --- |
| `client/` | `apiRequest`, `httpRequest`, the session, errors, rate limits and retry rules |
| `deployment/` | The server address the person chose, and the probe that checks it |
| `cache/` | Saved copies of answers (`cachedRequest`), kept encrypted on the computer |
| `managed/` | The request to the managed AI gateway, used by agents and devices |
| `runtime/` | The sockets and calls to this computer's agent runtime (`runtimeSocket`, device models, memory and embeddings), used by agents, memory and voice |
| `account-events*` | The account event stream |

Rules:

- `api/` imports no feature and no app code (`.config/eslint.config.js` enforces it).
- Use `apiRequest` for the account server and `spaceRequest` (in `features/spaces/api`) for a Space.
- A client for one feature's endpoints lives in that feature: `account/api`, `agents/api`,
  `devices/api`, `files/api`, `spaces/api`, `spaces/library/api`, `spaces/journal/...`.
