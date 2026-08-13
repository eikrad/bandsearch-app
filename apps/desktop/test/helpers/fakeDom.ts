// Stand-ins for the few DOM objects the desktop shell takes as collaborators.
//
// The production code only stores these and hands them to React or reads one or
// two fields, so a full DOM implementation would be noise. These helpers keep
// the narrowing in one place instead of casting at every call site.

import type { ReactNode } from "react";
import type { Root } from "react-dom/client";

/** A mount container. React roots are faked in these tests, so nothing reads it. */
export function fakeContainer(props: Partial<HTMLElement> = {}): HTMLElement {
  return props as unknown as HTMLElement;
}

/** A global `window` stand-in; only `matchMedia` and `location` are read. */
export function fakeWindow(props: Partial<Window> = {}): Window & typeof globalThis {
  return props as unknown as Window & typeof globalThis;
}

/** A React root that records what it was asked to render instead of touching the DOM. */
export function fakeReactRoot(onRender: (element: ReactNode) => void = () => {}): Root {
  return {
    render: onRender,
    unmount: () => {},
  };
}

/** A matchMedia result; only `matches` and the listener hooks are exercised. */
export function fakeMediaQueryList(matches: boolean): MediaQueryList {
  return {
    matches,
    addEventListener: () => {},
    removeEventListener: () => {},
  } as unknown as MediaQueryList;
}
