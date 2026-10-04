package api

import (
	"context"
	"errors"
	"time"

	"github.com/gorilla/websocket"
)

func (s *AgentsService) openVoiceTransport(ctx context.Context, client *websocket.Conn, rtc bool, account ...string) (voiceProvider, error) {
	analyzer := s.voiceAnalyzer
 configured := false
 if len(account) > 0 { var err error; analyzer, configured, err = analyzer.ConfiguredRealtime(ctx, account[0]); if err != nil { return nil, err } }
	if rtc {
		client.SetReadLimit(100 << 10)
		_ = client.SetReadDeadline(time.Now().Add(20 * time.Second))
		var offer struct {
			Type string `json:"type"`
			SDP  string `json:"sdp"`
		}
		if client.ReadJSON(&offer) != nil || offer.Type != "rtc.offer" {
			return nil, errors.New("invalid voice offer")
		}
		_ = client.SetReadDeadline(time.Time{})
		var provider voiceProvider
  answer := ""
  err := errors.New("account connection uses the websocket transport")
  if !configured { provider, answer, err = analyzer.OpenVoiceWebRTC(ctx, offer.SDP) }
		if err == nil {
			if err = client.WriteJSON(map[string]string{"type": "rtc.answer", "sdp": answer}); err != nil {
				provider.Close()
				return nil, err
			}
			return provider, nil
		}
		// No input has been accepted or committed. An abandoned call is hung up
		// by the adapter before the gateway transport can receive buffered input.
		if err := client.WriteJSON(map[string]string{"type": "transport.fallback", "transport": "websocket"}); err != nil {
			return nil, err
		}
	}
	return analyzer.OpenVoiceRealtime(ctx)
}
