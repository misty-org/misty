package routes

func AuthRoutes() []Route {
	return []Route{
		{Method: "POST", Path: "/register", Group: "auth"},
		{Method: "POST", Path: "/login", Group: "auth"},
		{Method: "POST", Path: "/logout", Group: "auth"},
		{Method: "POST", Path: "/refresh", Group: "auth"},
	}
}
