package tsbase

import (
	"sync"

	"tailscale.com/client/local"
	"tailscale.com/tsnet"
)

type TSStatus string

const (
	OFFLINE      TSStatus = "offline"
	CONNECTED             = "connected"
	ERROR                 = "error"
	UNAUTHORIZED          = "unauthorized"
)

type TSBase struct {
	TSServer *tsnet.Server
	TSClient *local.Client
	TSState  *TSState
	TSPeerMap map[string]*TSPeer
	TSServerPeer *TSPeer
	mu       sync.Mutex
}

type TSPeerType string

const (
	CLIENT TSPeerType = "client"
	SERVER          = "server"
)

type TSPeer struct {
	PeerHostName   string     `json:"peer_hostname"`
	PeerType TSPeerType `json:"peer_type"`
	PeerAddress string `json:"peer_address"`
}


type TSState struct {
	Status      TSStatus `json:"status"`
	AuthURL     string   `json:"auth_url"`
	ConnectedIP string   `json:"connected_ip"`
}

type TSPing struct {
	IP      string `json:"ip"`
	Success bool   `json:"success"`
	Latency float64 `json:"latency,omitempty"`
	Error   string `json:"error,omitempty"`
}
