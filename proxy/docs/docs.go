package docs

import (
	_ "embed"

	"github.com/swaggo/swag"
)

//go:embed swagger.json
var swaggerDoc string

type embeddedSwagger struct{}

func (embeddedSwagger) ReadDoc() string {
	return swaggerDoc
}

func init() {
	swag.Register("swagger", embeddedSwagger{})
}
