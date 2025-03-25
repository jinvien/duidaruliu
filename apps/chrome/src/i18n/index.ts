import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import enTranslation from '@/assets/locales/en/translate.json';
import esTranslation from '@/assets/locales/es/translate.json';
import frTranslation from '@/assets/locales/fr/translate.json';
import jaTranslation from '@/assets/locales/ja/translate.json';
import koTranslation from '@/assets/locales/ko/translate.json';
import ruTranslation from '@/assets/locales/ru/translate.json';
import zhTranslation from '@/assets/locales/zh/translate.json';

const resources = {
  en: { translation: enTranslation },
  es: { translation: esTranslation },
  fr: { translation: frTranslation },
  ja: { translation: jaTranslation },
  ko: { translation: koTranslation },
  ru: { translation: ruTranslation },
  zh: { translation: zhTranslation },
  'zh-CN': { translation: zhTranslation },
};

const getUserLang = async () => {
  const { appSettings } = await chrome.storage.sync.get('appSettings');
  return appSettings.lang;
};

(async () => {
  i18n.use(initReactI18next).init({
    resources,
    fallbackLng: 'en',
    lng: await getUserLang(),
    interpolation: {
      escapeValue: false,
    },
  });
})();

export default i18n;
