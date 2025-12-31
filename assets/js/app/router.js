const ROUTES = ["feed", "groups", "messages", "notifications"];
const DEFAULT_ROUTE = "feed";
const listeners = new Set();
let currentRoute = null;

const normalizeRoute = (route) => {
  if (!route) return DEFAULT_ROUTE;
  const clean = route.replace(/^#\/?/, "").replace(/^\//, "");
  const segment = clean.split("?")[0].split("/")[0];
  return ROUTES.includes(segment) ? segment : DEFAULT_ROUTE;
};

const getRouteFromHash = () => normalizeRoute(window.location.hash);

const notify = (route) => {
  if (route === currentRoute) return;
  currentRoute = route;
  listeners.forEach((handler) => handler(route));
};

const syncRoute = (replace = false) => {
  const route = getRouteFromHash();
  const targetHash = `#/${route}`;
  if (window.location.hash !== targetHash) {
    if (replace) {
      history.replaceState(null, "", targetHash);
      notify(route);
    } else {
      window.location.hash = targetHash;
    }
    return;
  }
  notify(route);
};

const handleRouteChange = () => syncRoute(false);

const router = {
  start() {
    window.addEventListener("hashchange", handleRouteChange);
    window.addEventListener("popstate", handleRouteChange);
    syncRoute(true);
  },
  navigate(route) {
    const target = normalizeRoute(route);
    const targetHash = `#/${target}`;
    if (window.location.hash === targetHash) {
      notify(target);
      return;
    }
    window.location.hash = targetHash;
  },
  onChange(handler) {
    listeners.add(handler);
    return () => listeners.delete(handler);
  }
};

export default router;
