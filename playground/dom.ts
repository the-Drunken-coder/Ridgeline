export function element<T extends HTMLElement>(selector: string, type: new (...args: never[]) => T): T {
  const result = document.querySelector(selector);
  if (!(result instanceof type)) throw new Error(`Missing ${selector}`);
  return result;
}
