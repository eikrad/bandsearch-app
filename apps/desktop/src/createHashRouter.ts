/** The one route table: each route and the URL hash that opens it. */
export const ROUTES = {
  home: "#/",
  saved: "#/saved",
  settings: "#/settings",
  welcome: "#/welcome",
  login: "#/login",
  register: "#/register",
  "reset-password": "#/reset-password",
  privacy: "#/privacy",
  connecting: "#/connecting",
} as const;

export type Route = keyof typeof ROUTES;

const ROUTE_BY_HASH = new Map<string, Route>(
  (Object.entries(ROUTES) as Array<[Route, string]>).map(([route, hash]) => [hash, route]),
);

/** An empty or unknown hash, such as a stale bookmark, opens home. */
function hashToRoute(hash: string): Route {
  return ROUTE_BY_HASH.get(hash) ?? "home";
}

function routeToHash(route: Route): string {
  if (!Object.hasOwn(ROUTES, route)) throw new Error(`unknown route "${route}"`);
  return ROUTES[route];
}

export type HashRouterOptions = {
  getHash?: () => string;
  setHash?: (hash: string) => void;
  addListener?: (fn: () => void) => void;
  removeListener?: (fn: () => void) => void;
};

export function createHashRouter({
  getHash = () => (typeof globalThis !== "undefined" && globalThis.location ? globalThis.location.hash : ""),
  setHash = (hash: string) => {
    if (typeof globalThis !== "undefined" && globalThis.location) {
      globalThis.location.hash = hash;
    }
  },
  addListener = (fn: () => void) => {
    if (typeof globalThis !== "undefined" && globalThis.addEventListener) {
      globalThis.addEventListener("hashchange", fn);
    }
  },
  removeListener = (fn: () => void) => {
    if (typeof globalThis !== "undefined" && globalThis.removeEventListener) {
      globalThis.removeEventListener("hashchange", fn);
    }
  },
}: HashRouterOptions = {}) {
  const changeCallbacks: Array<(route: Route) => void> = [];
  // The route listeners last heard about. A browser fires `hashchange` for our
  // own navigate() too, after the fact; this tells that echo apart from a real
  // change such as the back button, so a screen is not rendered twice.
  let reportedRoute = hashToRoute(getHash());

  function getRoute(): Route {
    return hashToRoute(getHash());
  }

  function report(route: Route): void {
    reportedRoute = route;
    changeCallbacks.forEach((fn) => fn(route));
  }

  /** Changes the route and tells listeners before returning, in every environment. */
  function navigate(route: Route): void {
    const hash = routeToHash(route);
    reportedRoute = route;
    setHash(hash);
    report(route);
  }

  function handleHashChange(): void {
    const route = getRoute();
    if (route === reportedRoute) return;
    report(route);
  }

  addListener(handleHashChange);

  return {
    getRoute,
    navigate,
    onRouteChange(fn: (route: Route) => void) {
      changeCallbacks.push(fn);
      return () => {
        const i = changeCallbacks.indexOf(fn);
        if (i >= 0) changeCallbacks.splice(i, 1);
      };
    },
    destroy() {
      removeListener(handleHashChange);
    },
  };
}
