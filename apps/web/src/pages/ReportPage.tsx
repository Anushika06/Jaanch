import { useEffect, useRef, useState } from 'react';
import { api, ApiError, type Status } from '../api';
import { Report } from '../components/Report';
import { useApp } from '../context';
import type { StringKey } from '../i18n';
import { onLinkClick } from '../router';

const STAGES: Array<{ id: string; label: StringKey }> = [
  { id: 'reading', label: 'stageReading' },
  { id: 'extracting', label: 'stageExtracting' },
  { id: 'checking', label: 'stageChecking' },
  { id: 'adjudicating', label: 'stageAdjudicating' },
  { id: 'explaining', label: 'stageExplaining' },
];

function Progress({ stage }: { stage: string | null }) {
  const { t } = useApp();
  const current = STAGES.findIndex((s) => s.id === stage);
  return (
    <section className="progress" aria-live="polite">
      <ol>
        {STAGES.map((s, i) => {
          const state =
            current === -1
              ? i === 0
                ? 'active'
                : 'waiting'
              : i < current
                ? 'done'
                : i === current
                  ? 'active'
                  : 'waiting';
          return (
            <li key={s.id} className={`progress__step progress__step--${state}`}>
              <span className="progress__mark" aria-hidden="true" />
              {t(s.label)}
            </li>
          );
        })}
      </ol>
      <p className="fineprint">{t('progressNote')}</p>
    </section>
  );
}

export function ReportPage({ id }: { id: string }) {
  const { t, lang, meta } = useApp();
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    let delay = 800;
    const poll = async () => {
      try {
        const s = await api.status(id, lang);
        if (cancelled) return;
        setStatus(s);
        setError(null);
        if (s.status === 'queued' || s.status === 'running') {
          delay = Math.min(delay * 1.3, 3_000);
          timer.current = setTimeout(() => void poll(), delay);
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404)
          setError(t('errNotFound', { days: meta?.reportTtlDays ?? 7 }));
        else {
          setError(t('errNetwork'));
          timer.current = setTimeout(() => void poll(), 4_000);
        }
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
    // Re-fetch in the new language when the reader switches.
  }, [id, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main id="main" className="page-report">
      <a className="back" href="/" onClick={(e) => onLinkClick(e, '/')}>
        {t('newCheck')}
      </a>
      {error && !status && <p className="notice notice--error">{error}</p>}
      {status && (status.status === 'queued' || status.status === 'running') && (
        <Progress stage={status.stage} />
      )}
      {status?.status === 'failed' && <p className="notice notice--error">{t('errFailed')}</p>}
      {status?.status === 'completed' && status.view && (
        <Report view={status.view} expiresAt={status.expiresAt} />
      )}
      {!status && !error && <p className="fineprint">{t('loading')}</p>}
    </main>
  );
}
