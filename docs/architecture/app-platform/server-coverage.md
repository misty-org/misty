# Server SDK method coverage

Static inventory of legacy Go route registrations in app-relevant domains during the Hono migration. A registered method is not proof of native Hono implementation or app migration. Server permissions and resource checks remain authoritative.

319 candidate route/verb pairs; 74 currently match the server method registry.

| Verb | Server route | SDK method |
| --- | --- | --- |
| GET | `/activity/inbox` | pending review |
| POST | `/activity/inbox/clear` | pending review |
| POST | `/activity/inbox/seen` | pending review |
| GET | `/agent-runs/{runID}` | pending review |
| POST | `/agent-runs/{runID}/approvals/{approvalID}` | pending review |
| POST | `/agent-runs/{runID}/cancel` | pending review |
| POST | `/agent-runs/{runID}/contexts` | pending review |
| POST | `/agent-runs/{runID}/retry` | pending review |
| POST | `/agent-voice/transcriptions` | pending review |
| GET | `/agents` | pending review |
| GET | `/agents/{agentID}` | pending review |
| GET | `/agents/{agentID}/activity` | pending review |
| GET | `/agents/{agentID}/avatar` | pending review |
| POST | `/ai/runs` | pending review |
| GET | `/automations/flows` | pending review |
| POST | `/automations/tools/{toolName}` | pending review |
| GET | `/cloud/connections` | pending review |
| POST | `/cloud/connections/bind` | pending review |
| DELETE | `/cloud/connections/{connectionID}` | pending review |
| POST | `/cloud/connections/{connectionID}/handoff` | pending review |
| GET | `/cloud/connections/{connectionID}/token` | pending review |
| POST | `/cloud/connections/{provider}/authorize` | pending review |
| POST | `/cloud/handoffs/redeem` | pending review |
| GET | `/connections` | `connections.list` |
| DELETE | `/connections/{connectionID}` | `connections.remove` |
| GET | `/connections/{connectionID}/social/resources` | pending review |
| POST | `/connections/{provider}/authorize` | `connections.authorize` |
| GET | `/devices` | pending review |
| POST | `/devices` | pending review |
| GET | `/devices/peer-ticket-keys` | pending review |
| DELETE | `/devices/{deviceID}` | pending review |
| POST | `/devices/{deviceID}/adopt-legacy` | pending review |
| POST | `/devices/{deviceID}/heartbeat` | pending review |
| POST | `/devices/{deviceID}/pairing-sessions` | pending review |
| GET | `/devices/{deviceID}/pairing-sessions/{sessionID}` | pending review |
| POST | `/devices/{deviceID}/pairing-sessions/{sessionID}/confirm` | pending review |
| POST | `/devices/{deviceID}/pairing/redeem` | pending review |
| PUT | `/devices/{deviceID}/pairs/{pairID}/clipboard-consent` | pending review |
| PUT | `/devices/{deviceID}/pairs/{pairID}/name` | pending review |
| POST | `/devices/{deviceID}/pairs/{pairID}/revoke` | pending review |
| POST | `/devices/{deviceID}/peer-tickets` | pending review |
| GET | `/devices/{deviceID}/peers` | pending review |
| POST | `/devices/{deviceID}/presence` | pending review |
| POST | `/devices/{deviceID}/revoke` | pending review |
| POST | `/devices/{deviceID}/workflow-node-jobs/claim` | pending review |
| POST | `/devices/{deviceID}/workflow-node-jobs/{jobID}/complete` | pending review |
| POST | `/devices/{deviceID}/workflow-node-jobs/{jobID}/fail` | pending review |
| POST | `/devices/{deviceID}/workflow-node-jobs/{jobID}/lease` | pending review |
| GET | `/mail/accounts` | `mail.accounts.list` |
| POST | `/mail/drafts` | `mail.drafts.create` |
| PUT | `/mail/drafts/{draftID}` | `mail.drafts.update` |
| POST | `/mail/drafts/{draftID}/send` | `mail.drafts.send` |
| GET | `/mail/folders` | `mail.folders.list` |
| GET | `/mail/threads` | `mail.threads.list` |
| GET | `/mail/threads/{threadID}` | `mail.threads.get` |
| POST | `/mail/threads/{threadID}/actions` | `mail.threads.action` |
| POST | `/mcp` | pending review |
| GET | `/mcp/connections` | pending review |
| POST | `/mcp/connections` | pending review |
| DELETE | `/mcp/connections/{connectionID}` | pending review |
| GET | `/mcp/connections/{connectionID}` | pending review |
| POST | `/mcp/connections/{connectionID}/discover` | pending review |
| POST | `/mcp/connections/{connectionID}/test` | pending review |
| GET | `/mcp/connections/{connectionID}/tools` | pending review |
| POST | `/mcp/oauth/activepieces/authorize` | pending review |
| GET | `/me` | pending review |
| GET | `/me/avatar` | pending review |
| PUT | `/me/avatar` | pending review |
| POST | `/misty/attachments` | pending review |
| DELETE | `/misty/attachments/{attachmentID}` | pending review |
| GET | `/misty/attachments/{attachmentID}/content` | pending review |
| PUT | `/misty/attachments/{attachmentID}/content` | pending review |
| POST | `/misty/attachments/{attachmentID}/finalize` | pending review |
| GET | `/misty/conversations` | pending review |
| POST | `/misty/conversations` | pending review |
| DELETE | `/misty/conversations/{conversationID}` | pending review |
| PATCH | `/misty/conversations/{conversationID}` | pending review |
| POST | `/misty/conversations/{conversationID}/turns` | pending review |
| POST | `/search` | pending review |
| GET | `/search/global` | pending review |
| POST | `/search/global/visual` | pending review |
| GET | `/search/spaces` | pending review |
| GET | `/spaces` | pending review |
| POST | `/spaces` | pending review |
| POST | `/spaces/invitations/{inviteID}/accept` | pending review |
| POST | `/spaces/invitations/{inviteID}/decline` | pending review |
| GET | `/spaces/resolve/{ticket}` | pending review |
| DELETE | `/spaces/{spaceID}` | pending review |
| GET | `/spaces/{spaceID}` | `spaces.get` |
| PATCH | `/spaces/{spaceID}` | pending review |
| GET | `/spaces/{spaceID}/action-suggestion-settings` | pending review |
| PUT | `/spaces/{spaceID}/action-suggestion-settings` | pending review |
| GET | `/spaces/{spaceID}/action-suggestions` | pending review |
| POST | `/spaces/{spaceID}/action-suggestions/{batchID}/accept` | pending review |
| POST | `/spaces/{spaceID}/action-suggestions/{batchID}/dismiss` | pending review |
| GET | `/spaces/{spaceID}/action-suggestions/{batchID}/review` | pending review |
| GET | `/spaces/{spaceID}/agenda` | `agenda.list` |
| GET | `/spaces/{spaceID}/agents` | pending review |
| GET | `/spaces/{spaceID}/agents/{agentID}/runs` | pending review |
| GET | `/spaces/{spaceID}/agents/{agentID}/toolbox` | pending review |
| GET | `/spaces/{spaceID}/attachments/{attachmentID}/download` | pending review |
| POST | `/spaces/{spaceID}/attachments/{attachmentID}/promote` | pending review |
| GET | `/spaces/{spaceID}/calendar/events` | `calendar.events.list` |
| POST | `/spaces/{spaceID}/calendar/events` | `calendar.events.create` |
| DELETE | `/spaces/{spaceID}/calendar/events/{eventID}` | `calendar.events.delete` |
| PATCH | `/spaces/{spaceID}/calendar/events/{eventID}` | `calendar.events.update` |
| GET | `/spaces/{spaceID}/calendar/google/calendars` | `calendar.google.calendars` |
| GET | `/spaces/{spaceID}/calendar/sources` | `calendar.sources.list` |
| POST | `/spaces/{spaceID}/calendar/sources` | `calendar.sources.create` |
| DELETE | `/spaces/{spaceID}/calendar/sources/{sourceID}` | `calendar.sources.delete` |
| POST | `/spaces/{spaceID}/calendar/sync` | `calendar.sync` |
| GET | `/spaces/{spaceID}/code/github/workspaces` | pending review |
| POST | `/spaces/{spaceID}/code/github/workspaces` | pending review |
| DELETE | `/spaces/{spaceID}/code/github/workspaces/{workspaceID}` | pending review |
| POST | `/spaces/{spaceID}/code/github/workspaces/{workspaceID}/actions` | pending review |
| POST | `/spaces/{spaceID}/code/github/workspaces/{workspaceID}/credential-handoff` | pending review |
| GET | `/spaces/{spaceID}/code/github/workspaces/{workspaceID}/records` | pending review |
| POST | `/spaces/{spaceID}/code/github/workspaces/{workspaceID}/sync` | pending review |
| POST | `/spaces/{spaceID}/conversation-follow-ups/{followUpID}/cancel` | pending review |
| POST | `/spaces/{spaceID}/conversation-follow-ups/{followUpID}/opt-out` | pending review |
| GET | `/spaces/{spaceID}/conversations` | pending review |
| POST | `/spaces/{spaceID}/conversations` | pending review |
| DELETE | `/spaces/{spaceID}/conversations/{conversationID}` | pending review |
| PATCH | `/spaces/{spaceID}/conversations/{conversationID}` | pending review |
| DELETE | `/spaces/{spaceID}/conversations/{conversationID}/action-suggestion-veto` | pending review |
| GET | `/spaces/{spaceID}/conversations/{conversationID}/action-suggestion-veto` | pending review |
| PUT | `/spaces/{spaceID}/conversations/{conversationID}/action-suggestion-veto` | pending review |
| GET | `/spaces/{spaceID}/conversations/{conversationID}/messages` | pending review |
| POST | `/spaces/{spaceID}/conversations/{conversationID}/messages` | pending review |
| DELETE | `/spaces/{spaceID}/conversations/{conversationID}/messages/{messageID}` | pending review |
| PUT | `/spaces/{spaceID}/conversations/{conversationID}/messages/{messageID}` | pending review |
| DELETE | `/spaces/{spaceID}/conversations/{conversationID}/messages/{messageID}/reactions/{emoji}` | pending review |
| PUT | `/spaces/{spaceID}/conversations/{conversationID}/messages/{messageID}/reactions/{emoji}` | pending review |
| POST | `/spaces/{spaceID}/conversations/{conversationID}/read` | pending review |
| GET | `/spaces/{spaceID}/drawings` | `drawings.list` |
| POST | `/spaces/{spaceID}/drawings` | `drawings.create` |
| GET | `/spaces/{spaceID}/drawings/figma/bindings` | pending review |
| POST | `/spaces/{spaceID}/drawings/figma/bindings` | pending review |
| DELETE | `/spaces/{spaceID}/drawings/figma/bindings/{bindingID}` | pending review |
| POST | `/spaces/{spaceID}/drawings/figma/bindings/{bindingID}/comments` | pending review |
| GET | `/spaces/{spaceID}/drawings/figma/bindings/{bindingID}/context` | pending review |
| POST | `/spaces/{spaceID}/drawings/figma/bindings/{bindingID}/reconcile-webhooks` | pending review |
| GET | `/spaces/{spaceID}/drawings/figma/bindings/{bindingID}/records` | pending review |
| POST | `/spaces/{spaceID}/drawings/figma/bindings/{bindingID}/sync` | pending review |
| DELETE | `/spaces/{spaceID}/drawings/{drawingID}` | `drawings.delete` |
| GET | `/spaces/{spaceID}/drawings/{drawingID}` | `drawings.get` |
| PATCH | `/spaces/{spaceID}/drawings/{drawingID}` | `drawings.update` |
| GET | `/spaces/{spaceID}/drawings/{drawingID}/assets` | pending review |
| POST | `/spaces/{spaceID}/drawings/{drawingID}/assets/uploads` | `drawings.assets.reserve` |
| POST | `/spaces/{spaceID}/drawings/{drawingID}/assets/uploads/{uploadID}/finalize` | `drawings.assets.finalize` |
| DELETE | `/spaces/{spaceID}/drawings/{drawingID}/assets/{assetID}` | pending review |
| GET | `/spaces/{spaceID}/drawings/{drawingID}/assets/{assetID}/download` | `drawings.assets.download` |
| POST | `/spaces/{spaceID}/drawings/{drawingID}/collaboration-ticket` | `drawings.collaboration.ticket` |
| GET | `/spaces/{spaceID}/home` | pending review |
| POST | `/spaces/{spaceID}/home/visits` | pending review |
| GET | `/spaces/{spaceID}/integrations` | `integrations.list` |
| POST | `/spaces/{spaceID}/integrations/github/install` | pending review |
| GET | `/spaces/{spaceID}/integrations/github/installations` | pending review |
| DELETE | `/spaces/{spaceID}/integrations/github/installations/{installationID}` | pending review |
| GET | `/spaces/{spaceID}/integrations/github/installations/{installationID}/repositories` | pending review |
| GET | `/spaces/{spaceID}/integrations/{integrationID}/resources` | pending review |
| PUT | `/spaces/{spaceID}/integrations/{integrationID}/resources` | pending review |
| POST | `/spaces/{spaceID}/integrations/{provider}/authorize` | pending review |
| POST | `/spaces/{spaceID}/integrations/{provider}/bind` | `integrations.bind` |
| GET | `/spaces/{spaceID}/invitations` | pending review |
| POST | `/spaces/{spaceID}/invitations` | pending review |
| DELETE | `/spaces/{spaceID}/invitations/{inviteID}` | pending review |
| POST | `/spaces/{spaceID}/invitations/{inviteID}/resend` | pending review |
| POST | `/spaces/{spaceID}/leave` | pending review |
| GET | `/spaces/{spaceID}/library` | pending review |
| GET | `/spaces/{spaceID}/library/album-folders` | pending review |
| POST | `/spaces/{spaceID}/library/album-folders` | pending review |
| DELETE | `/spaces/{spaceID}/library/album-folders/{folderID}` | pending review |
| PATCH | `/spaces/{spaceID}/library/album-folders/{folderID}` | pending review |
| GET | `/spaces/{spaceID}/library/albums` | pending review |
| POST | `/spaces/{spaceID}/library/albums` | pending review |
| DELETE | `/spaces/{spaceID}/library/albums/{albumID}` | pending review |
| GET | `/spaces/{spaceID}/library/albums/{albumID}` | pending review |
| PATCH | `/spaces/{spaceID}/library/albums/{albumID}` | pending review |
| GET | `/spaces/{spaceID}/library/albums/{albumID}/items` | pending review |
| POST | `/spaces/{spaceID}/library/albums/{albumID}/items` | pending review |
| DELETE | `/spaces/{spaceID}/library/albums/{albumID}/items/{itemID}` | pending review |
| POST | `/spaces/{spaceID}/library/albums/{albumID}/order` | pending review |
| PUT | `/spaces/{spaceID}/library/albums/{albumID}/organization` | pending review |
| GET | `/spaces/{spaceID}/library/asset-stacks` | pending review |
| POST | `/spaces/{spaceID}/library/asset-stacks` | pending review |
| DELETE | `/spaces/{spaceID}/library/asset-stacks/{stackID}` | pending review |
| PATCH | `/spaces/{spaceID}/library/asset-stacks/{stackID}` | pending review |
| GET | `/spaces/{spaceID}/library/discovery` | pending review |
| PATCH | `/spaces/{spaceID}/library/discovery/memory/{memoryID}` | pending review |
| GET | `/spaces/{spaceID}/library/discovery/{kind}/{groupID}/items` | pending review |
| POST | `/spaces/{spaceID}/library/duplicates/merge` | pending review |
| POST | `/spaces/{spaceID}/library/exports/download` | pending review |
| GET | `/spaces/{spaceID}/library/facets` | pending review |
| DELETE | `/spaces/{spaceID}/library/grants/{grantID}` | pending review |
| GET | `/spaces/{spaceID}/library/groups` | pending review |
| POST | `/spaces/{spaceID}/library/groups` | pending review |
| GET | `/spaces/{spaceID}/library/groups/{groupID}/items` | pending review |
| POST | `/spaces/{spaceID}/library/imports` | pending review |
| GET | `/spaces/{spaceID}/library/imports/history` | pending review |
| POST | `/spaces/{spaceID}/library/items/bulk` | pending review |
| POST | `/spaces/{spaceID}/library/items/duplicate` | pending review |
| GET | `/spaces/{spaceID}/library/items/{itemID}` | pending review |
| PATCH | `/spaces/{spaceID}/library/items/{itemID}` | pending review |
| GET | `/spaces/{spaceID}/library/items/{itemID}/download` | pending review |
| GET | `/spaces/{spaceID}/library/items/{itemID}/preview` | pending review |
| POST | `/spaces/{spaceID}/library/items/{itemID}/provider-import` | pending review |
| POST | `/spaces/{spaceID}/library/items/{itemID}/restore` | pending review |
| POST | `/spaces/{spaceID}/library/items/{itemID}/trash` | pending review |
| GET | `/spaces/{spaceID}/library/items/{itemID}/versions` | pending review |
| POST | `/spaces/{spaceID}/library/items/{itemID}/versions` | pending review |
| PUT | `/spaces/{spaceID}/library/items/{itemID}/versions/current` | pending review |
| DELETE | `/spaces/{spaceID}/library/items/{itemID}/versions/{editID}` | pending review |
| POST | `/spaces/{spaceID}/library/items/{itemID}/versions/{editID}/render` | pending review |
| GET | `/spaces/{spaceID}/library/people` | pending review |
| POST | `/spaces/{spaceID}/library/people` | pending review |
| POST | `/spaces/{spaceID}/library/people/merge` | pending review |
| GET | `/spaces/{spaceID}/library/people/policy` | pending review |
| PATCH | `/spaces/{spaceID}/library/people/policy` | pending review |
| DELETE | `/spaces/{spaceID}/library/people/{personID}` | pending review |
| GET | `/spaces/{spaceID}/library/people/{personID}` | pending review |
| PATCH | `/spaces/{spaceID}/library/people/{personID}` | pending review |
| DELETE | `/spaces/{spaceID}/library/people/{personID}/items` | pending review |
| GET | `/spaces/{spaceID}/library/people/{personID}/items` | pending review |
| POST | `/spaces/{spaceID}/library/people/{personID}/items` | pending review |
| GET | `/spaces/{spaceID}/library/pins` | pending review |
| PUT | `/spaces/{spaceID}/library/pins` | pending review |
| POST | `/spaces/{spaceID}/library/reauthenticate` | pending review |
| GET | `/spaces/{spaceID}/library/search/semantic` | pending review |
| GET | `/spaces/{spaceID}/library/shared` | pending review |
| POST | `/spaces/{spaceID}/library/shared` | pending review |
| GET | `/spaces/{spaceID}/library/shared/{referenceID}/download` | pending review |
| POST | `/spaces/{spaceID}/library/uploads` | pending review |
| PUT | `/spaces/{spaceID}/library/uploads/{uploadID}/content` | pending review |
| POST | `/spaces/{spaceID}/library/uploads/{uploadID}/finalize` | pending review |
| GET | `/spaces/{spaceID}/library/usage` | pending review |
| GET | `/spaces/{spaceID}/members` | `spaces.members.list` |
| DELETE | `/spaces/{spaceID}/members/{userID}` | pending review |
| GET | `/spaces/{spaceID}/members/{userID}/avatar` | pending review |
| GET | `/spaces/{spaceID}/members/{userID}/permissions` | pending review |
| PUT | `/spaces/{spaceID}/members/{userID}/permissions` | pending review |
| DELETE | `/spaces/{spaceID}/messages` | pending review |
| GET | `/spaces/{spaceID}/messages` | pending review |
| POST | `/spaces/{spaceID}/messages` | pending review |
| DELETE | `/spaces/{spaceID}/messages/{messageID}` | pending review |
| PUT | `/spaces/{spaceID}/messages/{messageID}` | pending review |
| DELETE | `/spaces/{spaceID}/messages/{messageID}/reactions/{emoji}` | pending review |
| PUT | `/spaces/{spaceID}/messages/{messageID}/reactions/{emoji}` | pending review |
| GET | `/spaces/{spaceID}/nodes` | pending review |
| POST | `/spaces/{spaceID}/nodes` | pending review |
| DELETE | `/spaces/{spaceID}/nodes/{nodeID}` | pending review |
| PUT | `/spaces/{spaceID}/nodes/{nodeID}` | pending review |
| POST | `/spaces/{spaceID}/nodes/{nodeID}/resolve` | pending review |
| GET | `/spaces/{spaceID}/notes` | `notes.list` |
| POST | `/spaces/{spaceID}/notes` | `notes.create` |
| DELETE | `/spaces/{spaceID}/notes/{noteID}` | `notes.delete` |
| GET | `/spaces/{spaceID}/notes/{noteID}` | `notes.get` |
| PATCH | `/spaces/{spaceID}/notes/{noteID}` | `notes.archive` |
| GET | `/spaces/{spaceID}/notes/{noteID}/assets` | pending review |
| POST | `/spaces/{spaceID}/notes/{noteID}/assets/uploads` | `notes.assets.reserve` |
| POST | `/spaces/{spaceID}/notes/{noteID}/assets/uploads/{uploadID}/finalize` | `notes.assets.finalize` |
| DELETE | `/spaces/{spaceID}/notes/{noteID}/assets/{assetID}` | pending review |
| GET | `/spaces/{spaceID}/notes/{noteID}/assets/{assetID}/download` | `notes.assets.download` |
| GET | `/spaces/{spaceID}/notes/{noteID}/backlinks` | `notes.backlinks` |
| POST | `/spaces/{spaceID}/notes/{noteID}/collaboration-ticket` | `notes.collaboration.ticket` |
| PATCH | `/spaces/{spaceID}/notes/{noteID}/metadata` | `notes.update` |
| GET | `/spaces/{spaceID}/provider-resources` | pending review |
| POST | `/spaces/{spaceID}/provider-resources` | pending review |
| DELETE | `/spaces/{spaceID}/provider-resources/{resourceID}` | pending review |
| POST | `/spaces/{spaceID}/read` | pending review |
| POST | `/spaces/{spaceID}/resources/{resourceKind}/{resourceID}/share-with-space` | pending review |
| GET | `/spaces/{spaceID}/roadmap-node-definitions` | `roadmaps.nodeDefinitions.list` |
| POST | `/spaces/{spaceID}/roadmap-node-definitions` | `roadmaps.nodeDefinitions.create` |
| DELETE | `/spaces/{spaceID}/roadmap-node-definitions/{definitionID}` | `roadmaps.nodeDefinitions.delete` |
| PATCH | `/spaces/{spaceID}/roadmap-node-definitions/{definitionID}` | `roadmaps.nodeDefinitions.update` |
| GET | `/spaces/{spaceID}/roadmaps` | `roadmaps.list` |
| POST | `/spaces/{spaceID}/roadmaps` | `roadmaps.create` |
| DELETE | `/spaces/{spaceID}/roadmaps/{roadmapID}` | `roadmaps.delete` |
| GET | `/spaces/{spaceID}/roadmaps/{roadmapID}` | `roadmaps.get` |
| PATCH | `/spaces/{spaceID}/roadmaps/{roadmapID}` | `roadmaps.update` |
| POST | `/spaces/{spaceID}/roadmaps/{roadmapID}/edges` | `roadmaps.edges.create` |
| DELETE | `/spaces/{spaceID}/roadmaps/{roadmapID}/edges/{edgeID}` | `roadmaps.edges.delete` |
| PATCH | `/spaces/{spaceID}/roadmaps/{roadmapID}/edges/{edgeID}` | `roadmaps.edges.update` |
| POST | `/spaces/{spaceID}/roadmaps/{roadmapID}/goals` | `roadmaps.goals.create` |
| DELETE | `/spaces/{spaceID}/roadmaps/{roadmapID}/goals/{goalID}` | `roadmaps.goals.delete` |
| PATCH | `/spaces/{spaceID}/roadmaps/{roadmapID}/goals/{goalID}` | `roadmaps.goals.update` |
| PUT | `/spaces/{spaceID}/roadmaps/{roadmapID}/goals/{goalID}/tasks` | `roadmaps.goals.setTasks` |
| PATCH | `/spaces/{spaceID}/roadmaps/{roadmapID}/layout` | `roadmaps.layout.update` |
| POST | `/spaces/{spaceID}/roadmaps/{roadmapID}/milestones` | `roadmaps.milestones.create` |
| DELETE | `/spaces/{spaceID}/roadmaps/{roadmapID}/milestones/{milestoneID}` | `roadmaps.milestones.delete` |
| PATCH | `/spaces/{spaceID}/roadmaps/{roadmapID}/milestones/{milestoneID}` | `roadmaps.milestones.update` |
| POST | `/spaces/{spaceID}/roadmaps/{roadmapID}/nodes` | `roadmaps.nodes.create` |
| DELETE | `/spaces/{spaceID}/roadmaps/{roadmapID}/nodes/{nodeID}` | `roadmaps.nodes.delete` |
| PATCH | `/spaces/{spaceID}/roadmaps/{roadmapID}/nodes/{nodeID}` | `roadmaps.nodes.update` |
| GET | `/spaces/{spaceID}/setup` | pending review |
| PATCH | `/spaces/{spaceID}/setup` | pending review |
| GET | `/spaces/{spaceID}/social/authorities` | pending review |
| POST | `/spaces/{spaceID}/social/authorities` | pending review |
| GET | `/spaces/{spaceID}/social/automation-rules` | pending review |
| POST | `/spaces/{spaceID}/social/automation-rules` | pending review |
| GET | `/spaces/{spaceID}/social/bindings` | pending review |
| POST | `/spaces/{spaceID}/social/bindings` | pending review |
| DELETE | `/spaces/{spaceID}/social/bindings/{bindingID}` | pending review |
| GET | `/spaces/{spaceID}/social/providers` | pending review |
| GET | `/spaces/{spaceID}/social/scheduled-messages` | pending review |
| POST | `/spaces/{spaceID}/social/scheduled-messages` | pending review |
| DELETE | `/spaces/{spaceID}/social/scheduled-messages/{scheduledID}` | pending review |
| GET | `/spaces/{spaceID}/studio/workflows` | pending review |
| POST | `/spaces/{spaceID}/studio/workflows` | pending review |
| DELETE | `/spaces/{spaceID}/studio/workflows/{resourceID}` | pending review |
| GET | `/spaces/{spaceID}/studio/workflows/{workflowID}/versions` | pending review |
| POST | `/spaces/{spaceID}/studio/workflows/{workflowID}/versions` | pending review |
| GET | `/spaces/{spaceID}/tasks` | `tasks.list` |
| POST | `/spaces/{spaceID}/tasks` | `tasks.create` |
| DELETE | `/spaces/{spaceID}/tasks/{taskID}` | `tasks.delete` |
| PATCH | `/spaces/{spaceID}/tasks/{taskID}` | `tasks.update` |
| GET | `/spaces/{spaceID}/tasks/{taskID}/activity` | `tasks.activity.list` |
| POST | `/spaces/{spaceID}/tasks/{taskID}/move` | `tasks.move` |
| POST | `/spaces/{spaceID}/transfer` | pending review |
