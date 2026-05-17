package rclone

import (
	"context"
	"fmt"
	"sort"
	"strings"
)


type RemoteInfo struct {
	Name string `json:"name"`
	Type string `json:"type"`
}

func ListRemotes(ctx context.Context) ([]RemoteInfo, error) {
	if err := Init(); err != nil {
		return nil, err
	}
	if err := defaultRcloneRCD.Start(); err != nil {
		return nil, err
	}

	var response struct {
		Remotes []struct {
			Name string `json:"name"`
			Type string `json:"type"`
		} `json:"remotes"`
	}

	if err := defaultRcloneRCD.Call(ctx, "config/listremotes", map[string]any{}, &response); err != nil {
		return nil, err
	}

	remotes := make([]RemoteInfo, 0, len(response.Remotes))
	for _, remote := range response.Remotes {
		remotes = append(remotes, RemoteInfo{
			Name: remote.Name,
			Type: remote.Type,
		})
	}

	sort.Slice(remotes, func(i, j int) bool {
		return remotes[i].Name < remotes[j].Name
	})

	return remotes, nil
}

func RemoteExists(name string) bool {
	remotes, err := ListRemotes(context.Background())
	if err != nil {
		return false
	}
	name = strings.TrimSpace(name)
	for _, remote := range remotes {
		if remote.Name == name {
			return true
		}
	}
	return false
}

func GetRemoteType(name string) string {
	remotes, err := ListRemotes(context.Background())
	if err != nil {
		return ""
	}
	name = strings.TrimSpace(name)
	for _, remote := range remotes {
		if remote.Name == name {
			return remote.Type
		}
	}
	return ""
}

func StartManagedDaemon(context.Context) error {
	if err := Init(); err != nil {
		return err
	}
	return defaultRcloneRCD.Start()
}

func StopManagedDaemon() {
	_ = defaultRcloneRCD.Stop()
}

func EnsureAllRemoteDefaults() error {
	return nil
}

func MkDir(context.Context, string, string) error {
	return fmt.Errorf("rclone mkdir not implemented")
}

func CreateRemote(context.Context, string, string, map[string]string) error {
	return fmt.Errorf("rclone create remote not implemented")
}

func DeleteRemote(string) error {
	return fmt.Errorf("rclone delete remote not implemented")
}
