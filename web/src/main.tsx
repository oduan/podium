import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "./index.css";
import { RequireAuth } from "./components/RequireAuth";
import LoginPage from "./pages/LoginPage";
import ChatPage from "./pages/ChatPage";
import SettingsPage from "./pages/SettingsPage";
import { HistoryRouter, Navigate, useLocation } from "./router";

function Routes() {
  const { pathname } = useLocation();
  if (pathname === "/login") return <LoginPage />;

  let page: React.ReactNode;
  if (pathname === "/" || pathname === "") page = <ChatPage />;
  else if (pathname === "/settings") page = <SettingsPage />;
  else if (/^\/sessions\/[^/]+\/?$/.test(pathname)) page = <ChatPage />;
  else return <Navigate to="/" replace />;

  return <RequireAuth>{page}</RequireAuth>;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HistoryRouter>
      <Routes />
    </HistoryRouter>
  </React.StrictMode>,
);
