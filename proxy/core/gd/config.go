package gd

import (
	"log"
	"os"
	"path/filepath"
	"sync"

	"github.com/joho/godotenv"
)

type GDriveConfig struct {
	ClientID     string
	ClientSecret string
	RedirectURI  string
	AuthURL      string
	TokenURL     string
	APIBase      string
	Scopes       []string
}

var (
	config     *GDriveConfig
	configOnce sync.Once
)

func GetConfig() *GDriveConfig {
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

		config = &GDriveConfig{
			ClientID:     os.Getenv("GD_CLIENT_ID"),
			ClientSecret: os.Getenv("GD_CLIENT_SECRET"),
			RedirectURI:  os.Getenv("GD_REDIRECT_URI"),
			AuthURL:      "https://accounts.google.com/o/oauth2/auth",
			TokenURL:     "https://oauth2.googleapis.com/token",
			APIBase:      "https://www.googleapis.com",
			Scopes: []string{
				"https://www.googleapis.com/auth/drive",
				"https://www.googleapis.com/auth/userinfo.email",
				"https://www.googleapis.com/auth/userinfo.profile",
			},
		}
	})
	return config
}

func (c *GDriveConfig) GetScopesString() string {
	result := ""
	for i, s := range c.Scopes {
		if i > 0 {
			result += " "
		}
		result += s
	}
	return result
}