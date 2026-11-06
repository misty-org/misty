// Its own file, not the barrel: the auth pages import the welcome feature, so the welcome page
// importing the barrel back would be a cycle.
export { authButtonClass } from "./components/authButtonClass";
