import { createContext, useContext } from 'react';
import type { Meta } from './api';
import { tr, type Lang, type StringKey } from './i18n';

export interface AppState {
  lang: Lang;
  setLang: (l: Lang) => void;
  meta: Meta | null;
}

export const AppContext = createContext<AppState>({
  lang: 'en',
  setLang: () => undefined,
  meta: null,
});

export function useApp() {
  const ctx = useContext(AppContext);
  const t = (key: StringKey, params?: Record<string, string | number>) => tr(ctx.lang, key, params);
  return { ...ctx, t };
}
