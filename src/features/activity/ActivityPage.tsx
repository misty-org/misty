import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { openActivityPanel } from "./activityPanelState";

/** Compatibility for saved Activity links; Activity itself lives above the workspace. */
export function ActivityPage() {
  const { search } = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    openActivityPanel(`/activity${search}`);
    navigate("/home", { replace: true });
  }, [navigate, search]);
  return null;
}
