package utils

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
)

func GenerateShortHash(secret []byte, deviceName string) string {
    h := hmac.New(sha256.New, secret)
    h.Write([]byte(deviceName))
    
    fullHash := hex.EncodeToString(h.Sum(nil))
    
    return fullHash[:8]
}
