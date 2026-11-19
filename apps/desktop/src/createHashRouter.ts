const ROUTE_MAP: Record<string, string> = {
  "": "home",
  "#/": "home",
  "#/saved": "saved",
  "#/settings": "settings",
  "#/welcome": "welcome",
  "#/login": "login",
  "#/register": "register",
  "#/reset-password": "reset-password",
  "#/privacy": "privacy",
  "#/connecting": "connecting",
};

function hashToRoute(hash: string): string {
  return ROUTE_MAP[hash] ?? "home";
}

function routeToHash(route: string): string {
  if (route === "saved") return "#/saved";
  if (route === "settings") return "#/settings";
  if (route === "welcome") return "#/welcome";
  if (route === "login") return "#/login";
  if (route === "register") return "#/register";
  if (route === "reset-password") return "#/reset-password";
  if (route === "privacy") return "#/privacy";
  if (route === "connecting") return "#/connecting";
  return "#/";
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
  const changeCallbacks: Array<(route: string) => void> = [];
  // The route listeners last heard about. A browser fires `hashchange` for our
  // own navigate() too, after the fact; this tells that echo apart from a real
  // change such as the back button, so a screen is not rendered twice.
  let reportedRoute = hashToRoute(getHash());

  function getRoute(): string {
    return hashToRoute(getHash());
  }

  function report(route: string): void {
    reportedRoute = route;
    changeCallbacks.forEach((fn) => fn(route));
  }

  /** Changes the route and tells listeners before returning, in every environment. */
  function navigate(route: string): void {
    const hash = routeToHash(route);
    reportedRoute = hashToRoute(hash);
    setHash(hash);
    report(hashToRoute(hash));
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
    onRouteChange(fn: (route: string) => void) {
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
