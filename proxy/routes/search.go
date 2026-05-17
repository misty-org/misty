package routes

func SearchRoutes() []Route {
	return []Route{
		{Method: "POST", Path: "/search", Group: "search"},
	}
}
