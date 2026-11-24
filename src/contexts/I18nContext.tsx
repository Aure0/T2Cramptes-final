import React, { createContext, useCallback, useContext, useEffect, useMemo } from 'react';
import { translate, type AppLocale, type TranslationKey } from '../utils/i18n';

export interface I18nContextValue {
  locale: AppLocale;
  setLocale: (locale: AppLocale) => void;
  toggleLocale: () => void;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue>({
  locale: 'en',
  setLocale: () => {},
  toggleLocale: () => {},
  t: (key, params) => translate('en', key, params),
});

interface I18nProviderProps {
  locale: AppLocale;
  onChangeLocale: (next: AppLocale) => void;
  children: React.ReactNode;
}

export const I18nProvider: React.FC<I18nProviderProps> = ({
  locale,
  onChangeLocale,
  children,
}) => {
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = locale;
      document.title = translate(locale, 'app.documentTitle');
    }
  }, [locale]);

  const toggleLocale = useCallback(() => {
    onChangeLocale(locale === 'fr' ? 'en' : 'fr');
  }, [locale, onChangeLocale]);

  const t = useCallback(
    (key: TranslationKey, params?: Record<string, string | number>) =>
      translate(locale, key, params),
    [locale]
  );

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale: onChangeLocale,
      toggleLocale,
      t,
    }),
    [locale, onChangeLocale, toggleLocale, t]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}
