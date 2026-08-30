// Stand-ins for the few DOM objects the desktop shell takes as collaborators.
//
// The production code only stores these and hands them to React or reads one or
// two fields, so a full DOM implementation would be noise. These helpers keep
// the narrowing in one place instead of casting at every call site.

import { Fragment, isValidElement, type ReactElement, type ReactNode } from "react";
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

/**
 * The mount always renders `<Fragment>[banner?, routedView]</Fragment>` — a
 * fixed shape, so the routed view keeps its React identity (and its DOM state)
 * when the update banner appears or is dismissed. Tests assert on the routed
 * view, so unwrap it from that envelope.
 */
export function routedViewOf(rendered: ReactNode): ReactElement {
  const element = rendered as ReactElement<{ children?: ReactNode }>;
  if (element?.type !== Fragment) return element;
  const children = element.props.children;
  const list = Array.isArray(children) ? children : [children];
  return list[list.length - 1] as ReactElement;
}

/** A matchMedia result; only `matches` and the listener hooks are exercised. */
export function fakeMediaQueryList(matches: boolean): MediaQueryList {
  return {
    matches,
    addEventListener: () => {},
    removeEventListener: () => {},
  } as unknown as MediaQueryList;
}

/**
 * First element in a rendered tree matching `predicate`, or undefined.
 *
 * View tests need a handle on one control to fire its `onClick` — markup alone
 * cannot show which handler a view actually assigned. Shared because two tests
 * grew their own near-identical walker before this existed.
 */
export function findElement(
  node: unknown,
  predicate: (element: ReactElement) => boolean,
): ReactElement | undefined {
  if (!isValidElement(node)) return undefined;
  const element = node as ReactElement<{ children?: ReactNode }>;
  if (predicate(element)) return element;
  const children = element.props.children;
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = findElement(child, predicate);
    if (found) return found;
  }
  return undefined;
}
