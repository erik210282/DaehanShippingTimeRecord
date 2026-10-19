// src/i18n/i18n.js
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import es from './es.json';
import en from './en.json';
import ko from './ko.json';

const nativeLanguage = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('nativeShipping') === '1'
  ? new URLSearchParams(window.location.search).get('lang') : null;

i18n
  .use(initReactI18next)
  .init({
    resources: {
      es: { translation: es },
      en: { translation: en },
      ko: { translation: ko },
    },
    lng: ['es','en','ko'].includes(nativeLanguage) ? nativeLanguage : 'es',
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;
