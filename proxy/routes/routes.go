package routes

type Route struct {
	Method       string
	Path         string
	Group        string
	AuthRequired bool
}

func APIRoutes() []Route {
	groups := [][]Route{
		AuthRoutes(),
		HealthRoutes(),
		SearchRoutes(),
		RemoteRoutes(),
		VaultRoutes(),
	}

	total := 0
	for _, group := range groups {
		total += len(group)
	}

	routes := make([]Route, 0, total)
	for _, group := range groups {
		routes = append(routes, group...)
	}
	return routes
}
