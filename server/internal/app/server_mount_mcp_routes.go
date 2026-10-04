package app

import (
	api "github.com/kannachi323/misty/server/internal/platform/httpapi"
)

func (s *Server) mountMCPRoutes(prefix string, spaces *api.SpacesService) {
	s.Router.Get(prefix+"/integrations/apps", spaces.ConnectedApps())
	s.Router.Get(prefix+"/integrations/apps/catalog", spaces.AppCatalog())
	s.Router.Post(prefix+"/integrations/apps/connect", spaces.ConnectApp())
	s.Router.Delete(prefix+"/integrations/apps/connections/{accountID}", spaces.DisconnectApp())
	s.Router.Get(prefix+"/me/app-requests/{requestID}", spaces.AppRequestControl())
	s.Router.Post(prefix+"/me/app-requests/{requestID}", spaces.AppRequestControl())
	s.Router.Post(prefix+"/me/app-requests/{requestID}/link", spaces.AppRequestLink())
	s.Router.Post(prefix+"/me/screen-model/{jobID}", spaces.ScreenModel())
}
