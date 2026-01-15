package tsbase

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/kannachi323/minidfs/proxy/core/utils"
	"golang.org/x/crypto/bcrypt"
)

type TSConfig struct {
	DeviceID string `json:"device_id"`
	ServerID string `json:"server_id"`
	BaseName string `json:"base_name"`

}

func GetConfigPath() string {
	home, _ := os.UserHomeDir()
	configPath := filepath.Join(home, ".minidfs", "config.json")

	return configPath
}

func IsValidServerID(hashedID string) bool {
    home, _ := os.UserHomeDir()
	secretPath := filepath.Join(home, ".minidfs", "secret.txt")

	secretFile, err := os.ReadFile(secretPath)
	if err != nil {
		fmt.Printf("error reading secret file: %w", err)
		return false
	}
    err = bcrypt.CompareHashAndPassword([]byte(hashedID), secretFile)
    return err == nil
}

func (config *TSConfig) GetHashedBaseName() string {
	home, _ := os.UserHomeDir()
	secretPath := filepath.Join(home, ".minidfs", "secret.txt")

	secret, err := os.ReadFile(secretPath)
	if err != nil {
		fmt.Printf("error reading secret file: %w", err)
		return ""
	}
	hash := utils.GenerateShortHash(secret, config.BaseName)
	serverHostName := fmt.Sprintf("%s-%s", config.BaseName, hash)

	return serverHostName
}

func LoadConfig(path string) (*TSConfig, error) {
	file, err := os.Open(path)
	if err != nil { 
		return nil, fmt.Errorf("could not open config file: %w", err)
	}
	defer file.Close()

	var config TSConfig
	decoder := json.NewDecoder(file)
	if err := decoder.Decode(&config); err != nil {
		return nil, fmt.Errorf("could not decode config file: %w", err)
	}

	return &config, nil
}

