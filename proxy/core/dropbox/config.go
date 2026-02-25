package dropbox

import (
	"log"
	"os"
	"path/filepath"
	"sync"

	"github.com/joho/godotenv"
)

type DropboxConfig struct {
	ClientID     string
	ClientSecret string
	RedirectURI  string
	AuthURL      string
	TokenURL     string
	APIBase      string
	ContentBase  string
}

var (
	config     *DropboxConfig
	configOnce sync.Once
)

func GetConfig() *DropboxConfig {
	configOnce.Do(func() {
		home, err := os.UserHomeDir()
		if err != nil {
			log.Println("Could not determine user home directory:", err)
			return
		}
		envPath := filepath.Join(home, "misty", "misty.env")
		if err := godotenv.Load(envPath); err != nil {
			devEnvPath := filepath.Join(home, "misty", "misty.env.development")
			if err2 := godotenv.Load(devEnvPath); err2 != nil {
				log.Println("No .env file found (checked misty.env and misty.env.development), relying on system environment variables")
			}
		}

		config = &DropboxConfig{
			ClientID:     os.Getenv("DBX_CLIENT_ID"),
			ClientSecret: os.Getenv("DBX_CLIENT_SECRET"),
			RedirectURI:  os.Getenv("DBX_REDIRECT_URI"),
			AuthURL:      "https://www.dropbox.com/oauth2/authorize",
			TokenURL:     "https://api.dropboxapi.com/oauth2/token",
			APIBase:      "https://api.dropboxapi.com/2",
			ContentBase:  "https://content.dropboxapi.com/2",
		}
	})
	return config
}
