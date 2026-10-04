import { useEffect, useRef, useState } from 'react';
import { api, ApiError, type Status } from '../api';
import { IconArrowLeft, IconCheck } from '../components/Icons';
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

/** Seconds since mount, ticking once a second. */
function useElapsed() {
  const [start] = useState(() => Date.now());
  const [now, setNow] = useState(start);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return Math.floor((now - start) / 1000);
}

function Progress({ stage }: { stage: string | null }) {
  const { t } = useApp();
  const elapsed = useElapsed();
  const current = Math.max(
    0,
    STAGES.findIndex((s) => s.id === stage),
  );
  // When each stage was first seen, so finished steps show how long they really took.
  const seen = useRef<Record<number, number>>({});
  if (seen.current[current] === undefined) seen.current[current] = elapsed;
  const durationOf = (i: number) => {
    const from = seen.current[i];
    const to = seen.current[i + 1] ?? elapsed;
    return from === undefined ? null : Math.max(0, to - from);
  };

  return (
    <section className="progress" aria-labelledby="progress-title">
      <div className="progress__head">
        <h1 id="progress-title" className="progress__title">
          {t('progressTitle')}
        </h1>
        <span className="progress__clock" aria-hidden="true">
          {t('progressElapsed', { s: elapsed })}
        </span>
      </div>
      <div className="progress__bar" aria-hidden="true">
        <span style={{ width: `${((current + 0.5) / STAGES.length) * 100}%` }} />
      </div>
      <ol className="progress__list" aria-live="polite">
        {STAGES.map((s, i) => {
          const state = i < current ? 'done' : i === current ? 'active' : 'waiting';
          const took = state === 'done' ? durationOf(i) : null;
          return (
            <li
              key={s.id}
              className={`progress__step progress__step--${state}`}
              aria-current={state === 'active' ? 'step' : undefined}
            >
              <span className="progress__mark" aria-hidden="true">
                {state === 'done' && <IconCheck size={14} />}
              </span>
              <span className="progress__label">{t(s.label)}</span>
              <span className="progress__time" aria-hidden="true">
                {took !== null ? t('progressElapsed', { s: took }) : ''}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="fineprint progress__note">{t('progressNote')}</p>
    </section>
  );
}

function ReportSkeleton() {
  return (
    <div className="skeleton" aria-hidden="true">
      <span className="skeleton__line skeleton__line--h1" />
      <span className="skeleton__line skeleton__line--h1 skeleton__line--short" />
      <span className="skeleton__line" />
      <span className="skeleton__block" />
      <span className="skeleton__block" />
    </div>
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
        <IconArrowLeft /> {t('newCheck')}
      </a>
      {error && !status && <p className="notice notice--error">{error}</p>}
      {status && (status.status === 'queued' || status.status === 'running') && (
        <Progress stage={status.stage} />
      )}
      {status?.status === 'failed' && <p className="notice notice--error">{t('errFailed')}</p>}
      {status?.status === 'completed' && status.view && (
        <Report view={status.view} expiresAt={status.expiresAt} />
      )}
      {!status && !error && (
        <>
          <p className="visually-hidden" role="status">
            {t('loading')}
          </p>
          <ReportSkeleton />
        </>
      )}
    </main>
  );
}
