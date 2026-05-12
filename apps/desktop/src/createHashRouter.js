const ROUTE_MAP = {
  "": "home",
  "#/": "home",
  "#/saved": "saved",
  "#/settings": "settings",
};

function hashToRoute(hash) {
  return ROUTE_MAP[hash] ?? "home";
}

function routeToHash(route) {
  if (route === "saved") return "#/saved";
  if (route === "settings") return "#/settings";
  return "#/";
}

function createHashRouter({
  getHash = () => (typeof globalThis !== "undefined" && globalThis.location ? globalThis.location.hash : ""),
  setHash = (hash) => {
    if (typeof globalThis !== "undefined" && globalThis.location) {
      globalThis.location.hash = hash;
    }
  },
  addListener = (fn) => {
    if (typeof globalThis !== "undefined" && globalThis.addEventListener) {
      globalThis.addEventListener("hashchange", fn);
    }
  },
  removeListener = (fn) => {
    if (typeof globalThis !== "undefined" && globalThis.removeEventListener) {
      globalThis.removeEventListener("hashchange", fn);
    }
  },
} = {}) {
  const changeCallbacks = [];

  function getRoute() {
    return hashToRoute(getHash());
  }

  function navigate(route) {
    setHash(routeToHash(route));
  }

  function handleHashChange() {
    const route = getRoute();
    changeCallbacks.forEach((fn) => fn(route));
  }

  addListener(handleHashChange);

  return {
    getRoute,
    navigate,
    onRouteChange(fn) {
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

module.exports = { createHashRouter };
