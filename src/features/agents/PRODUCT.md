# Agents workspace

Mode: Operate. Platform: Misty's desktop app and responsive web UI.

The account owner starts and returns to ongoing agent conversations, edits an agent’s identity and instructions, and inspects recorded work. Agents belong to the account; profiles do not grant separate app permissions or provision a cloud computer.

## Approved direction

The user supplied Dot onboarding and conversation screenshots and asked to implement their conversation-first organization using Misty’s shared components and styling. Keep Misty’s existing cloud avatars, compact agent roster, an open central conversation with a bottom composer, and one persistent right-hand overview card. At narrower widths the overview uses the shared Sheet. Use restrained shared control and island radii, monochrome UI and status icons, and minimal copy. Existing avatar assets are identity artwork, not status colors.

The overview exposes identity and actual state, message dictation, companion controls, account tool connections, local device availability, recent activity and explicit completed action results. Talk records a message for review; it is not a new realtime calling service. Activity retains its existing inspection, approval and cancellation controls. Outputs must come from completed assistant action results, not inferred attachments or citations.

Create-agent setup has Identity, Context and Start steps. Context reviews account access and opens the existing connection manager; Start offers chat or, on supported native hosts, opening desktop companion controls after creation. Neither choice creates new permissions. Preserve unsaved-profile and unsent-message guards, account boundaries, server persistence and historical conversation routing.

## Implementation boundary

AgentsPage.tsx, agentsWorkspace.css and the feature’s components. Shared controls remain the source of button, input, popover, sheet and panel styling. Settings, Spaces and Scheduled are outside this task. The isolated review harness uses labeled illustrative data, not live user records.
