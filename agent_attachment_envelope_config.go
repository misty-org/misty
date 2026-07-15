package main

import (
	"encoding/json"
	"errors"
	"os"
	"strings"

	"github.com/kannachi323/misty/server/api"
)

func agentAttachmentEnvelopeKeyringFromEnv() (*api.AgentAttachmentEnvelopeKeyring, error) {
	if strings.EqualFold(strings.TrimSpace(os.Getenv("DOCUMENT_STORE")), "memory") {
		return api.GenerateDevelopmentAgentAttachmentEnvelopeKeyring()
	}
	currentID := strings.TrimSpace(os.Getenv("DOCUMENT_KEY_ID"))
	currentKey := strings.TrimSpace(os.Getenv("DOCUMENT_PRIVATE_KEY_B64"))
	if currentID == "" || currentKey == "" {
		return nil, errors.New("DOCUMENT_KEY_ID and DOCUMENT_PRIVATE_KEY_B64 are required")
	}
	keys := map[string]string{currentID: currentKey}
	if previous := strings.TrimSpace(os.Getenv("DOCUMENT_PREVIOUS_KEYS_JSON")); previous != "" {
		var decoded map[string]string
		if json.Unmarshal([]byte(previous), &decoded) != nil {
			return nil, errors.New("DOCUMENT_PREVIOUS_KEYS_JSON must be a JSON object of key IDs to base64 PEM keys")
		}
		for keyID, encoded := range decoded {
			if _, exists := keys[keyID]; exists {
				return nil, errors.New("previous agent attachment key IDs must not duplicate the current key ID")
			}
			keys[keyID] = encoded
		}
	}
	return api.NewAgentAttachmentEnvelopeKeyring(currentID, keys)
}
