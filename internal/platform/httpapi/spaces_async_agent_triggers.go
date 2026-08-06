package api

import (
	"context"
	"time"

	db "github.com/kannachi323/misty/server/internal/platform/postgres"
)

func (s *SpacesService) enqueueSpaceAgentMessageTriggers(
	ctx context.Context,
	requestingUserID, spaceID, conversationID, sourceMessageID, triggerKind string,
	agentIDs []string,
	content []db.MessageSpan,
	fileNodeIDs, attachmentIDs, libraryItemIDs []string,
) ([]*db.SpaceAgentMessageTrigger, error) {
	triggers := make([]*db.SpaceAgentMessageTrigger, 0, len(agentIDs))
	for _, agentID := range uniqueStrings(agentIDs) {
		trigger, err := s.database.QueueSpaceAgentMessageTrigger(ctx, requestingUserID, spaceID, conversationID, sourceMessageID, agentID, triggerKind)
		if err != nil {
			return nil, err
		}
		triggers = append(triggers, trigger)
		if !trigger.Created {
			continue
		}
		background := context.WithoutCancel(ctx)
		go s.executeSpaceAgentMessageTrigger(background, trigger, requestingUserID, spaceID, conversationID, sourceMessageID, content, fileNodeIDs, attachmentIDs, libraryItemIDs)
	}
	return triggers, nil
}

func (s *SpacesService) executeSpaceAgentMessageTrigger(
	ctx context.Context,
	trigger *db.SpaceAgentMessageTrigger,
	requestingUserID, spaceID, conversationID, sourceMessageID string,
	content []db.MessageSpan,
	fileNodeIDs, attachmentIDs, libraryItemIDs []string,
) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Minute)
	defer cancel()
	if err := s.database.UpdateSpaceAgentMessageTrigger(ctx, trigger.ID, "working", "", "", ""); err != nil {
		return
	}
	_, runID, err := s.runMentionedAgent(ctx, requestingUserID, spaceID, conversationID, trigger.AgentID, sourceMessageID, trigger.TriggerKind, content, fileNodeIDs, attachmentIDs, libraryItemIDs)
	if err != nil {
		code, message := spaceRunFailureFromError(err)
		state := "failed"
		if ctx.Err() == context.Canceled {
			state = "canceled"
		}
		_ = s.database.UpdateSpaceAgentMessageTrigger(context.WithoutCancel(ctx), trigger.ID, state, runID, code, message)
		return
	}
	_ = s.database.UpdateSpaceAgentMessageTrigger(context.WithoutCancel(ctx), trigger.ID, "completed", runID, "", "")
}
