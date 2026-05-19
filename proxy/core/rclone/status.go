package rclone

import (
	"context"
	"strings"
)

type RemoteStatus struct {
	Name           string `json:"name"`
	Type           string `json:"type"`
	StatusLabel    string `json:"status_label"`
	NeedsReconnect bool   `json:"needs_reconnect"`
	Error          string `json:"error,omitempty"`
}

func ListRemoteStatuses(ctx context.Context) ([]RemoteStatus, error) {
	remotes, err := ListRemotes(ctx)
	if err != nil {
		return nil, err
	}

	statuses := make([]RemoteStatus, 0, len(remotes))
	for _, remote := range remotes {
		status := RemoteStatus{
			Name:        remote.Name,
			Type:        remote.Type,
			StatusLabel: "Connected",
		}

		_, err := ListDir(ctx, remote.Name, "")
		if err != nil {
			status.Error = strings.TrimSpace(err.Error())
			if needsReconnectError(err) {
				status.StatusLabel = "Needs reconnect"
				status.NeedsReconnect = true
			} else {
				status.StatusLabel = "Unavailable"
			}
		}

		statuses = append(statuses, status)
	}

	return statuses, nil
}

func needsReconnectError(err error) bool {
	if err == nil {
		return false
	}

	message := strings.ToLower(strings.TrimSpace(err.Error()))
	authHints := []string{
		"invalid_grant",
		"token expired",
		"expired token",
		"no refresh token",
		"refresh token",
		"couldn't fetch token",
		"oauth",
		"401 unauthorized",
		"unauthorized",
		"authentication failed",
		"access token expired",
		"run \"rclone config reconnect",
		"run `rclone config reconnect",
	}
	for _, hint := range authHints {
		if strings.Contains(message, hint) {
			return true
		}
	}
	return false
}
