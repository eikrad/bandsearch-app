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

  function getRoute(): string {
    return hashToRoute(getHash());
  }

  function navigate(route: string): void {
    setHash(routeToHash(route));
  }

  function handleHashChange(): void {
    const route = getRoute();
    changeCallbacks.forEach((fn) => fn(route));
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
