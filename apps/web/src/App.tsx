import { useEffect, useMemo, useState } from 'react';
import { api, type Meta } from './api';
import { AppContext } from './context';
import { initialLang, LANG_KEY, tr, type Lang } from './i18n';
import { Home } from './pages/Home';
import { PrivacyPage } from './pages/PrivacyPage';
import { RecoveryPage } from './pages/RecoveryPage';
import { ReportPage } from './pages/ReportPage';
import { onLinkClick, useRoute } from './router';

function Header({ lang, setLang }: { lang: Lang; setLang: (l: Lang) => void }) {
  return (
    <header className="site-header">
      <a
        className="wordmark"
        href="/"
        onClick={(e) => onLinkClick(e, '/')}
        aria-label="Jaanch home"
      >
        <span className="wordmark__dev" lang="hi">
          जाँच
        </span>
        <span className="wordmark__lat">Jaanch</span>
      </a>
      <button
        type="button"
        className="lang-toggle"
        onClick={() => setLang(lang === 'en' ? 'hi' : 'en')}
        lang={lang === 'en' ? 'hi' : 'en'}
      >
        {tr(lang, 'switchTo')}
      </button>
    </header>
  );
}

function Footer({ lang }: { lang: Lang }) {
  return (
    <footer className="site-footer">
      <p>{tr(lang, 'disclaimer')}</p>
      <p>
        <a href="/privacy" onClick={(e) => onLinkClick(e, '/privacy')}>
          {tr(lang, 'footerPrivacy')}
        </a>
      </p>
      <p className="fineprint">{tr(lang, 'footerContributors')}</p>
    </footer>
  );
}

export function App() {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const [meta, setMeta] = useState<Meta | null>(null);
  const route = useRoute();

  useEffect(() => {
    api
      .meta()
      .then(setMeta)
      .catch(() => setMeta(null));
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const ctx = useMemo(
    () => ({
      lang,
      meta,
      setLang: (l: Lang) => {
        setLangState(l);
        try {
          localStorage.setItem(LANG_KEY, l);
        } catch {
          /* storage unavailable */
        }
      },
    }),
    [lang, meta],
  );

  return (
    <AppContext.Provider value={ctx}>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <Header lang={lang} setLang={ctx.setLang} />
      {route.name === 'home' && <Home />}
      {route.name === 'report' && <ReportPage id={route.id} />}
      {route.name === 'paid' && <RecoveryPage id={route.id} />}
      {route.name === 'privacy' && <PrivacyPage />}
      {route.name === 'notfound' && (
        <main id="main" className="page-prose">
          <p className="notice">{tr(lang, 'errNotFound', { days: meta?.reportTtlDays ?? 7 })}</p>
        </main>
      )}
      <Footer lang={lang} />
    </AppContext.Provider>
  );
}
