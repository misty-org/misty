package ms

import (
	"log"
	"os"
	"path/filepath"
	"sync"

	"github.com/joho/godotenv"
)

type MSConfig struct {
	ClientID     string
	TenantID     string
	RedirectURI  string
	Authority    string
	Scopes       []string
	GraphBase	string
}


var (
	config     *MSConfig
	configOnce sync.Once
)

func GetConfig() *MSConfig {
	configOnce.Do(func() {
		home, err := os.UserHomeDir()
		if err != nil {
			log.Println("Could not determine user home directory:", err)
			return
		}
		envPath := filepath.Join(home, "misty", "misty.env")
		if err := godotenv.Load(envPath); err != nil {
			log.Println("No .env file found, relying on system environment variables")
		}

		config = &MSConfig{
			ClientID:     os.Getenv("MS_CLIENT_ID"),
			RedirectURI:  os.Getenv("MS_REDIRECT_URI"),
			TenantID:     os.Getenv("MS_TENANT_ID"),
			Authority:    "https://login.microsoftonline.com/common",
			Scopes: []string{
				"https://graph.microsoft.com/User.Read",
				"https://graph.microsoft.com/Files.ReadWrite.All",
				"offline_access",
				"openid",
			},
			GraphBase: "https://graph.microsoft.com/v1.0",

		}
	})
	return config
}

func (c *MSConfig) GetScopesString() string {
	result := ""
	for i, s := range c.Scopes {
		if i > 0 {
			result += " "
		}
		result += s
	}
	return result
}