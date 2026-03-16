import { JSDOM } from "jsdom";

function installDomGlobals() {
  if (typeof document !== "undefined") {
    return;
  }

  const { window } = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/",
  });

  for (const key of Object.getOwnPropertyNames(window)) {
    if (key in globalThis) {
      continue;
    }
    Object.defineProperty(globalThis, key, {
      configurable: true,
      enumerable: true,
      get: () => window[key as keyof typeof window],
    });
  }

  Object.defineProperties(globalThis, {
    document: {
      configurable: true,
      value: window.document,
    },
    navigator: {
      configurable: true,
      value: window.navigator,
    },
    window: {
      configurable: true,
      value: window,
    },
  });

  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;

  if (!("attachEvent" in window.HTMLElement.prototype)) {
    Object.defineProperty(window.HTMLElement.prototype, "attachEvent", {
      configurable: true,
      value: () => undefined,
    });
  }
  if (!("detachEvent" in window.HTMLElement.prototype)) {
    Object.defineProperty(window.HTMLElement.prototype, "detachEvent", {
      configurable: true,
      value: () => undefined,
    });
  }
}

installDomGlobals();

export function getByData(
  container: ParentNode,
  attribute: string,
  value: string,
): HTMLElement {
  const match = Array.from(container.querySelectorAll<HTMLElement>(`[${attribute}]`)).find(
    (element) => element.getAttribute(attribute) === value,
  );
  if (!match) {
    throw new Error(`Expected element with ${attribute}="${value}".`);
  }
  return match;
}

export function getAllByData(
  container: ParentNode,
  attribute: string,
): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(`[${attribute}]`));
}

export function getRequiredElement<TElement extends Element>(
  element: TElement | null | undefined,
  message: string,
): TElement {
  if (!element) {
    throw new Error(message);
  }
  return element;
}

export function textContent(node: ParentNode): string {
  return node.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

export function getReactProps<TProps extends object>(element: Element): TProps {
  const key = Object.keys(element).find((candidate) => candidate.startsWith("__reactProps$"));
  if (!key) {
    throw new Error("Expected React props on rendered element.");
  }
  return (element as unknown as Record<string, unknown>)[key] as TProps;
}
