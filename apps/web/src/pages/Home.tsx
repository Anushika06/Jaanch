import { Composer } from '../components/Composer';
import { HowItWorks, SourcesPanel, VerdictLegend, WhatsAppPanel } from '../components/HomeSections';
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
        <h1 id="hero-title" className="hero__title">
          {t('heroTitle')}
        </h1>
        <p className="hero__sub">{t('heroSub')}</p>
        <Composer initialText={sharedText} initialUrl={sharedUrl} />
        <p className="hero__note">{t('notAdvice')}</p>
      </section>
      <WhatsAppPanel />
      <HowItWorks />
      <VerdictLegend />
      <SourcesPanel />
    </main>
  );
}
