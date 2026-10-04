import { Composer } from '../components/Composer';
import { HeroPreview, HowItWorks, SourcesPanel, VerdictLegend } from '../components/HomeSections';
import { useApp } from '../context';

export function Home() {
  const { t } = useApp();
  // Android "share to Jaanch" (Web Share Target) arrives as ?text=…&url=…
  const params = new URLSearchParams(window.location.search);
  const sharedText = [params.get('title'), params.get('text')].filter(Boolean).join('\n');
  const sharedUrl = params.get('url') ?? '';

  return (
    <main id="main">
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero__main">
          <p className="eyebrow">
            {t('heroEyebrow')
              .split(' · ')
              .map((part, i) => (
                <span key={part}>
                  {i > 0 && (
                    <span className="eyebrow__sep" aria-hidden="true">
                      ·
                    </span>
                  )}
                  {part}
                </span>
              ))}
          </p>
          <h1 id="hero-title" className="hero__title">
            {t('heroTitle')}
          </h1>
          <p className="hero__sub">{t('heroSub')}</p>
          <ul className="trust" aria-label={t('trustLabel')}>
            <li className="trust__label" aria-hidden="true">
              {t('trustLabel')}
            </li>
            <li>SEBI</li>
            <li>RBI</li>
            <li>RDAP</li>
          </ul>
          <Composer initialText={sharedText} initialUrl={sharedUrl} />
          <p className="hero__note">{t('notAdvice')}</p>
        </div>
        <aside className="hero__aside">
          <HeroPreview />
        </aside>
      </section>
      <div className="home__sections">
        <HowItWorks />
        <VerdictLegend />
        <SourcesPanel />
      </div>
    </main>
  );
}
