export type Lang = "en" | "nl";

let current: Lang = "en";

export function setLang(l: Lang) {
  current = l;
  document.documentElement.lang = l;
}

export const lang = () => current;
export const locale = () => (current === "nl" ? "nl-NL" : "en-US");

/** Inline translation: `L("Clean", "Opschonen")`. */
export const L = (en: string, nl: string) => (current === "nl" ? nl : en);
