package routes

func HealthRoutes() []Route {
	return []Route{
		{Method: "GET", Path: "/health", Group: "health"},
	}
}
