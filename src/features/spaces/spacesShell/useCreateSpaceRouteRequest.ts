import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";

/** Opens the existing create flow when the global Space rail links here. */
export function useCreateSpaceRouteRequest(onRequest: () => void) {
  const location = useLocation();
  const navigate = useNavigate();
  const onRequestRef = useRef(onRequest);
  onRequestRef.current = onRequest;

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("createSpace") !== "1") return;

    params.delete("createSpace");
    onRequestRef.current();
    navigate(`${location.pathname}${params.size ? `?${params.toString()}` : ""}${location.hash}`, {
      replace: true,
    });
  }, [location.hash, location.pathname, location.search, navigate]);
}
