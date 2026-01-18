package tsbase

import (
	"context"
	"errors"
	"log"
	"net/netip"
	"time"

	"tailscale.com/ipn"
	"tailscale.com/tailcfg"
	"tailscale.com/tsnet"
)

func CreateTSBase(dataDir string) (*TSBase, error) {
	configPath := GetConfigPath()
	config, err := LoadConfig(configPath)
	if err != nil {
		return nil, err
	}
	hashedBaseName := config.GetHashedBaseName()
	server := &tsnet.Server{
		Hostname: hashedBaseName,
		Dir:      dataDir,
		Logf: func(format string, args ...any) {},
	}
	localClient, err := server.LocalClient()
	if err != nil {
		log.Fatalf("Failed to create local client: %v", err)
	}

	return &TSBase{
        TSServer: server,
        TSClient: localClient,
        TSState: &TSState{
			Status: OFFLINE,
			AuthURL: "",
			ConnectedIP: "",
		},
		TSPeerMap: make(map[string]*TSPeer),
		TSServerPeer: nil,
    }, nil
}

func (ts *TSBase) handleAuthEvent(url string) {
    ts.mu.Lock()
    defer ts.mu.Unlock()
    ts.TSState.AuthURL = url
    ts.TSState.Status = UNAUTHORIZED
}

func (ts *TSBase) handleNetMapEvent() {
	ts.mu.Lock()
	defer ts.mu.Unlock()
	ts.refreshNetworkMetadata()
}

func (ts *TSBase) handleStateTransition(state ipn.State) {
    ts.mu.Lock()
    defer ts.mu.Unlock()

    switch state {
    case ipn.Running:		
        ts.TSState.Status = CONNECTED
    case ipn.Stopped:
        ts.TSState.Status = OFFLINE
    case ipn.NeedsLogin:
        ts.TSState.Status = UNAUTHORIZED
    default:
        ts.TSState.Status = ERROR
    }

    ts.refreshNetworkMetadata()
}

func (ts *TSBase) refreshNetworkMetadata() {
    log.Println("refreshing metadata")
    // 1. Safety check
    if ts.TSClient == nil { return }

    status, err := ts.TSClient.Status(context.Background())
    if err != nil {
        log.Printf("Failed to refresh status: %v", err)
        return
    }

    if len(status.TailscaleIPs) > 0 {
        ts.TSState.ConnectedIP = status.TailscaleIPs[0].String()
    }

    newPeerMap := make(map[string]*TSPeer)

    config, _ := LoadConfig(GetConfigPath())
    serverHostName := ""
    if config != nil {
        serverHostName = config.GetHashedBaseName()
    }

    for _, node := range status.Peer {
        peer := &TSPeer{
            PeerHostName: node.HostName,
            PeerType:     CLIENT,
        }
        
        if node.HostName == serverHostName {
            peer.PeerType = SERVER
            ts.TSServerPeer = peer
        }

        for _, ip := range node.TailscaleIPs {
            if ip.Is4() {
                peer.PeerAddress = ip.String()
                break
            }
        }
        // CRITICAL: Put the peer in the map!
        newPeerMap[node.HostName] = peer
    }
    ts.TSPeerMap = newPeerMap
}

func (ts *TSBase) StartTSConnection() {
    go func() {
        watcher, err := ts.TSClient.WatchIPNBus(context.Background(), 0)
        if err != nil {
            log.Printf("Watcher error: %v", err)
            return
        }
        defer watcher.Close()

        for {
            n, err := watcher.Next()
            if err != nil {
                log.Printf("Watcher loop error: %v", err)
                return
            }

            // Route updates to specialized handlers
            if n.BrowseToURL != nil {
                ts.handleAuthEvent(*n.BrowseToURL)
                log.Println("transitioning to auth")
            }

            if n.State != nil {
                ts.handleStateTransition(*n.State)
                log.Println("transitioning to state")
            }

			if n.NetMap != nil {
				ts.handleNetMapEvent()
                log.Println("transitioning to netmap")
			}
        }
    }()
}

func (ts* TSBase) GetStatus() (TSState) {
	ts.mu.Lock()
	defer ts.mu.Unlock()

	return *ts.TSState
}

func (ts *TSBase) GetPeers() ([]*TSPeer, error) {
    ts.mu.Lock()
    defer ts.mu.Unlock()

    var peers []*TSPeer
    for _, peer := range ts.TSPeerMap {
        peers = append(peers, peer)
    }

    return peers, nil
}

func (ts *TSBase) GetServerPeer() (*TSPeer) {
	if ts.TSServerPeer != nil {
		return ts.TSServerPeer
	}
	for _, peer := range ts.TSPeerMap {
		if peer.PeerType == SERVER {
			ts.TSServerPeer = peer
			return peer
		}
	}
	return nil
}

func (ts *TSBase) GetPeerType(hostname string) TSPeerType {
	configPath := GetConfigPath()
	config, _ := LoadConfig(configPath)
	serverHostName := config.GetHashedBaseName()

	if hostname == serverHostName {
		return SERVER
	}
	return CLIENT
}

func (ts *TSBase) PingPeer(hostname string) *TSPing {
	ts.mu.Lock()
	peer, exists := ts.TSPeerMap[hostname]
	ts.mu.Unlock()

	if !exists {
		return &TSPing{
			IP:	hostname,
			Success: false,
			Error: "Peer not found in tailscale",
		}
	}

	targetAddress := peer.PeerAddress
	addr, _ := netip.ParseAddr(targetAddress)
    
    ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()

	pingRes, err := ts.TSClient.Ping(ctx, addr, tailcfg.PingICMP)
	if err != nil {
        errMsg := err.Error()
        if errors.Is(err, context.DeadlineExceeded) {
            errMsg = "request timed out after 5 seconds"
        }

		return &TSPing{
			IP: targetAddress,
			Success: false,
			Error: errMsg,
		}
	}

	return &TSPing{
		IP: targetAddress,
		Success: true,
		Latency: pingRes.LatencySeconds,
	}
}
