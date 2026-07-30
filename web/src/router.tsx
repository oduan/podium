import {
  createContext,
	useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from "react";

interface LocationValue {
  pathname: string;
  search: string;
  hash: string;
}

interface NavigateOptions {
  replace?: boolean;
  state?: unknown;
}

type NavigateFunction = (to: string, options?: NavigateOptions) => void;

const RouterContext = createContext<{
  location: LocationValue;
  navigate: NavigateFunction;
} | null>(null);

function readLocation(): LocationValue {
  return { pathname: window.location.pathname, search: window.location.search, hash: window.location.hash };
}

export function HistoryRouter({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState(readLocation);

  useEffect(() => {
    const onPopState = () => setLocation(readLocation());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

	const navigate = useCallback<NavigateFunction>((to, options) => {
      const target = new URL(to, window.location.href);
      if (target.origin !== window.location.origin) {
        window.location.assign(target.href);
        return;
      }
      const method = options?.replace ? "replaceState" : "pushState";
      window.history[method](options?.state ?? null, "", `${target.pathname}${target.search}${target.hash}`);
      setLocation(readLocation());
	}, []);
	const value = useMemo(() => ({ location, navigate }), [location, navigate]);

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

function useRouter() {
  const value = useContext(RouterContext);
  if (!value) throw new Error("Router hooks must be used inside HistoryRouter");
  return value;
}

export function useNavigate(): NavigateFunction {
  return useRouter().navigate;
}

export function useLocation(): LocationValue {
  return useRouter().location;
}

export function useParams(): { id?: string } {
  const match = /^\/sessions\/([^/]+)\/?$/.exec(useLocation().pathname);
  if (!match) return {};
  try {
    return { id: decodeURIComponent(match[1]) };
  } catch {
    return {};
  }
}

export function Navigate({ to, replace = false }: { to: string; replace?: boolean }) {
  const navigate = useNavigate();
  useEffect(() => navigate(to, { replace }), [navigate, replace, to]);
  return null;
}

export function Link({
  to,
  onClick,
  target,
  ...props
}: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { to: string }) {
  const navigate = useNavigate();
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      (target && target !== "_self")
    ) {
      return;
    }
    event.preventDefault();
    navigate(to);
  };
  return <a {...props} href={to} target={target} onClick={handleClick} />;
}
