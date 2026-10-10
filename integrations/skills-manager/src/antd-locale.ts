import type { Locale } from "antd/es/locale/index.js";

const zhCN: Locale = {
  locale: "zh-cn",
  global: { close: "Close" },
  Modal: { okText: "OK", cancelText: "Cancel", justOkText: "OK" },
};

const enUS: Locale = {
  locale: "en",
  global: { close: "Close" },
  Modal: { okText: "OK", cancelText: "Cancel", justOkText: "OK" },
};

export function antdLocale(active: "zh" | "en"): Locale {
  return enUS;
}

export function antdLocaleFromDocument(): Locale {
  if (typeof document === "undefined") return enUS;
  return antdLocale(document.documentElement.lang.toLowerCase().startsWith("en") ? "en" : "zh");
}
