import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import zh from "./locales/zh.json";

function detectLanguage(): string {
  const saved = localStorage.getItem("clash-web-language");
  if (saved) return saved;
  return navigator.language?.toLowerCase().startsWith("zh") ? "zh" : "en";
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    zh: { translation: zh },
  },
  lng: detectLanguage(),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

function syncHtmlLang(lng: string) {
  document.documentElement.lang = lng === "zh" ? "zh-CN" : "en";
}

syncHtmlLang(i18n.language);
i18n.on("languageChanged", syncHtmlLang);

export default i18n;
