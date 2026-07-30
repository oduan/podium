import { useEffect, useState } from "react";
import { Navigate } from "../router";
import { api, getToken } from "../api/client";

// RequireAuth verifies the stored token against the backend before rendering
// protected content, redirecting to /login when missing or invalid.
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<"checking" | "ok" | "fail">(getToken() ? "checking" : "fail");

  useEffect(() => {
    if (!getToken()) {
      setState("fail");
      return;
    }
    let active = true;
    api
      .verify()
      .then(() => active && setState("ok"))
      .catch(() => active && setState("fail"));
    return () => {
      active = false;
    };
  }, []);

  if (state === "checking") {
    return (
      <div className="h-full flex items-center justify-center text-ink-400">Checking session…</div>
    );
  }
  if (state === "fail") return <Navigate to="/login" replace />;
  return <>{children}</>;
}
