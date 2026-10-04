import { useEffect, useState } from 'react';
import { api, ApiError, type Recovery } from '../api';
import { useApp } from '../context';
import { onLinkClick } from '../router';

const GENERIC_STEPS = {
  en: [
    {
      id: 'call',
      text: 'Call 1930 right away — the national helpline for reporting financial fraud.',
      phone: '1930',
      href: null,
    },
    {
      id: 'portal',
      text: 'File a complaint at cybercrime.gov.in.',
      phone: null,
      href: 'https://cybercrime.gov.in',
    },
    {
      id: 'bank',
      text: 'Tell your bank it was a fraud, using the number on your card, passbook or the bank’s official app.',
      phone: null,
      href: null,
    },
  ],
  hi: [
    {
      id: 'call',
      text: 'तुरंत 1930 पर कॉल करें — वित्तीय धोखाधड़ी की शिकायत के लिए राष्ट्रीय हेल्पलाइन।',
      phone: '1930',
      href: null,
    },
    {
      id: 'portal',
      text: 'cybercrime.gov.in पर शिकायत दर्ज करें।',
      phone: null,
      href: 'https://cybercrime.gov.in',
    },
    {
      id: 'bank',
      text: 'कार्ड, पासबुक या बैंक के आधिकारिक ऐप पर दिए नंबर से बैंक को बताएँ कि यह धोखाधड़ी थी।',
      phone: null,
      href: null,
    },
  ],
};

/**
 * "I already paid": deterministic routing to official channels, plus a copyable evidence
 * summary. Nothing is collected — no amount, account number or transaction ID.
 */
export function RecoveryPage({ id }: { id: string }) {
  const { t, lang } = useApp();
  const [data, setData] = useState<Recovery | null>(null);
  const [missing, setMissing] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api
      .recovery(id, lang)
      .then(setData)
      .catch((err) => setMissing(err instanceof ApiError && err.status === 404));
  }, [id, lang]);

  const steps = data?.steps ?? (missing ? GENERIC_STEPS[lang] : []);

  async function copy() {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.summary);
    } catch {
      (document.getElementById('summary') as HTMLTextAreaElement | null)?.select();
      document.execCommand('copy');
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  return (
    <main id="main" className="page-recovery">
      {!missing && (
        <a className="back" href={`/r/${id}`} onClick={(e) => onLinkClick(e, `/r/${id}`)}>
          {t('backToReport')}
        </a>
      )}
      <h1 className="recovery__title">{t('recoveryTitle')}</h1>
      <p className="recovery__intro">{t('recoveryIntro')}</p>
      <ol className="recovery__steps">
        {steps.map((s) => (
          <li key={s.id}>
            <p>{s.text}</p>
            {s.phone && (
              <a className="button-urgent" href={`tel:${s.phone.replace(/\s+/g, '')}`}>
                {t('call', { phone: s.phone })}
              </a>
            )}
            {s.href && (
              <a
                className="button-secondary"
                href={s.href}
                target="_blank"
                rel="noopener noreferrer"
              >
                {s.href.replace(/^https?:\/\//, '').replace(/\/$/, '')}
              </a>
            )}
          </li>
        ))}
      </ol>
      {data && (
        <section className="recovery__summary" aria-labelledby="summary-title">
          <h2 id="summary-title">{t('recoverySummaryTitle')}</h2>
          <p className="fineprint">{t('recoverySummaryNote')}</p>
          <textarea id="summary" readOnly value={data.summary} rows={14} />
          <button type="button" className="button-secondary" onClick={() => void copy()}>
            {copied ? t('copied') : t('copySummary')}
          </button>
        </section>
      )}
    </main>
  );
}
