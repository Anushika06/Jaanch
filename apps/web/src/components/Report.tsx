import type { BindingView, ClaimView, EvidenceView, ReportView, RuleView } from '@jaanch/core';
import { useState } from 'react';
import { api, forgetToken, tokenFor } from '../api';
import { useApp } from '../context';
import { formatDate } from '../i18n';
import { navigate, onLinkClick } from '../router';
import { Stamp } from './Stamp';

const KIND_LABELS: Record<string, { en: string; hi: string }> = {
  registration: { en: 'Registration numbers', hi: 'रजिस्ट्रेशन नंबर' },
  organization: { en: 'Organisations', hi: 'संस्थाएँ' },
  person: { en: 'People', hi: 'लोग' },
  phone: { en: 'Phone numbers', hi: 'फ़ोन नंबर' },
  upi: { en: 'UPI IDs', hi: 'UPI ID' },
  url: { en: 'Links', hi: 'लिंक' },
  email: { en: 'Emails', hi: 'ईमेल' },
  handle: { en: 'Social handles', hi: 'सोशल हैंडल' },
  bank: { en: 'Bank accounts (masked)', hi: 'बैंक खाते (छिपे हुए)' },
  app: { en: 'Apps', hi: 'ऐप' },
};

const IDENTIFIER =
  /\b(IN[A-Z]\d{9}|IN-DP-[\w-]+|MF\/\d{3}\/\d{2}\/\d{1,2}|ARN-\d+|[\w.-]+@[\w.-]+|\+\d{6,15})\b/g;

/** Render identifiers (registration numbers, UPI IDs, phones) in a monospace face for exactness. */
function WithIds({ text }: { text: string }) {
  const parts: Array<string | { id: string }> = [];
  let last = 0;
  for (const m of text.matchAll(IDENTIFIER)) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push({ id: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return (
    <>
      {parts.map((p, i) =>
        typeof p === 'string' ? (
          <span key={i}>{p}</span>
        ) : (
          <code key={i} className="ident">
            {p.id}
          </code>
        ),
      )}
    </>
  );
}

function Evidence({ items, rules }: { items: EvidenceView[]; rules: RuleView[] }) {
  const { t, lang } = useApp();
  if (!items.length && !rules.length) return null;
  return (
    <details className="evidence">
      <summary>
        <span className="evidence__closed">{t('showEvidence')}</span>
        <span className="evidence__open">{t('hideEvidence')}</span>
      </summary>
      {items.map((e) => (
        <figure key={e.id} className={`record ${e.isFixture ? 'record--fixture' : ''}`}>
          <figcaption>
            <strong>{e.title}</strong>
            <span className="record__meta">
              {e.sourceName}
              {e.asOf ? `, ${t('asOf', { date: formatDate(e.asOf, lang) })}` : ''}
            </span>
          </figcaption>
          {e.fields.length > 0 && (
            <dl className="record__fields">
              {e.fields.map((f) => (
                <div key={f.key}>
                  <dt>{f.label}</dt>
                  <dd>
                    <WithIds text={f.value} />
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {e.url && (
            <a className="record__link" href={e.url} target="_blank" rel="noopener noreferrer">
              {t('openSource')}
            </a>
          )}
        </figure>
      ))}
      {rules.map((r) => (
        <figure key={r.id} className="record record--rule">
          <figcaption>
            <span className="record__kind">{t('ruleLabel')}</span>
            <strong>{r.statement}</strong>
          </figcaption>
          <ul className="citations">
            {r.citations.map((c) => (
              <li key={`${c.reference}-${c.clause}`}>
                <a href={c.url} target="_blank" rel="noopener noreferrer">
                  {c.title}
                </a>
                <span>
                  {' '}
                  {c.reference}
                  {c.clause ? `, ${c.clause}` : ''} ({formatDate(c.date, lang)})
                </span>
              </li>
            ))}
          </ul>
        </figure>
      ))}
    </details>
  );
}

function ClaimEntry({ c }: { c: ClaimView }) {
  const { t } = useApp();
  return (
    <li className={`claim claim--${c.verdict.toLowerCase()}`}>
      <div className="claim__stamp">
        <Stamp verdict={c.verdict} label={c.verdictLabel} />
      </div>
      <div className="claim__body">
        <p className="claim__statement">
          <WithIds text={c.statement} />
        </p>
        <blockquote className="claim__quote" cite="#">
          <span className="claim__quote-label">{t('quoteLabel')}</span>
          {c.quote}
        </blockquote>
        <p className="claim__explanation">
          <WithIds text={c.explanation} />
        </p>
        {c.caveats.map((cv, i) => (
          <p key={i} className="claim__caveat">
            <WithIds text={cv} />
          </p>
        ))}
        <Evidence items={c.evidence} rules={c.rules} />
      </div>
    </li>
  );
}

function Binding({ b }: { b: BindingView }) {
  const { t } = useApp();
  return (
    <section className="binding" aria-labelledby={`binding-${b.id}`}>
      <h2 id={`binding-${b.id}`}>{t('bindingTitle')}</h2>
      <p className="binding__intro">
        {t('bindingIntro', { name: b.officialName, reg: b.registrationNumber })}
      </p>
      <table className="binding__table">
        <thead>
          <tr>
            <th scope="col">{t('colField')}</th>
            <th scope="col">{t('colMessage')}</th>
            <th scope="col">{t('colRecord')}</th>
            <th scope="col">{t('colResult')}</th>
          </tr>
        </thead>
        <tbody>
          {b.rows.map((r, i) => (
            <tr key={`${r.field}-${i}`} className={`row--${r.status}`}>
              <th scope="row">{r.fieldLabel}</th>
              <td data-label={t('colMessage')}>
                {r.inMessage ? <WithIds text={r.inMessage} /> : '—'}
              </td>
              <td data-label={t('colRecord')}>
                {r.inRecord ? <WithIds text={r.inRecord} /> : '—'}
              </td>
              <td data-label={t('colResult')}>
                <span className={`result result--${r.status}`}>{r.statusLabel}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Actions({ view }: { view: ReportView }) {
  const { t, lang } = useApp();
  const [copied, setCopied] = useState<'summary' | 'link' | null>(null);
  const [deleted, setDeleted] = useState(false);
  const token = tokenFor(view.id);

  async function copy(text: string, what: 'summary' | 'link') {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(what);
    setTimeout(() => setCopied(null), 2500);
  }

  async function share() {
    const url = window.location.href.split('?')[0]!;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Jaanch', url });
        return;
      } catch {
        /* cancelled: fall back to copying */
      }
    }
    await copy(url, 'link');
  }

  async function remove() {
    if (!token || !window.confirm(t('deleteReport'))) return;
    await api.remove(view.id, token).catch(() => undefined);
    forgetToken(view.id);
    setDeleted(true);
    setTimeout(() => navigate('/'), 1200);
  }

  if (deleted) return <p className="notice">{t('deleted')}</p>;
  return (
    <div className="actions">
      <a
        className="button-urgent"
        href={`/r/${view.id}/paid`}
        onClick={(e) => onLinkClick(e, `/r/${view.id}/paid`)}
      >
        {t('alreadyPaid')}
      </a>
      <button
        type="button"
        className="button-secondary"
        onClick={() => void api.summary(view.id, lang).then((s) => copy(s, 'summary'))}
      >
        {copied === 'summary' ? t('copied') : t('copySummary')}
      </button>
      <button type="button" className="button-secondary" onClick={() => void share()}>
        {copied === 'link' ? t('linkCopied') : t('shareReport')}
      </button>
      {token && (
        <button type="button" className="linkish" onClick={() => void remove()}>
          {t('deleteReport')}
        </button>
      )}
    </div>
  );
}

export function Report({ view, expiresAt }: { view: ReportView; expiresAt: string }) {
  const { t, lang } = useApp();
  const counts = view.counts;
  const tally = [
    { verdict: 'CONTRADICTED' as const, n: counts.CONTRADICTED, label: t('stampContradicted') },
    { verdict: 'NOT_FOUND' as const, n: counts.NOT_FOUND, label: t('stampNotFound') },
    { verdict: 'CANT_CHECK' as const, n: counts.CANT_CHECK, label: t('stampCantCheck') },
    { verdict: 'MATCHES' as const, n: counts.MATCHES, label: t('stampMatches') },
  ].filter((x) => x.n > 0);

  return (
    <article className="report" lang={lang}>
      {view.fixtureBanner && (
        <p className="fixture-banner" role="note">
          {view.fixtureBanner}
        </p>
      )}

      <header className="report__head">
        <h1 className="report__headline">{view.headline}</h1>
        <p className="report__dates">
          {t('checkedOn', { date: formatDate(view.createdAt, lang, true) })}.{' '}
          {t('keptUntil', { date: formatDate(expiresAt, lang) })}.
        </p>
        {tally.length > 0 && (
          <ul className="tally" aria-label={t('claimsTitle')}>
            {tally.map((x) => (
              <li key={x.verdict} className={`tally__item tally__item--${x.verdict.toLowerCase()}`}>
                <span className="tally__n">{x.n}</span> {x.label}
              </li>
            ))}
          </ul>
        )}
      </header>

      {view.narrative && (
        <section className="inshort" aria-labelledby="inshort-title">
          <h2 id="inshort-title">{t('inShort')}</h2>
          <p>{view.narrative}</p>
        </section>
      )}

      <section aria-labelledby="claims-title">
        <h2 id="claims-title">{t('claimsTitle')}</h2>
        {view.claims.length === 0 ? (
          <p className="empty">{t('noClaims')}</p>
        ) : (
          <ol className="claims">
            {view.claims.map((c) => (
              <ClaimEntry key={c.id} c={c} />
            ))}
          </ol>
        )}
      </section>

      {view.bindings.map((b) => (
        <Binding key={b.id} b={b} />
      ))}

      {view.findings.length > 0 && (
        <section aria-labelledby="warn-title">
          <h2 id="warn-title">{t('warningsTitle')}</h2>
          <ul className="findings">
            {view.findings.map((f) => (
              <li key={f.id} className={`finding finding--${f.severity}`}>
                <span className="finding__severity">{f.severityLabel}</span>
                <p>
                  <WithIds text={f.text} />
                </p>
                <Evidence items={f.evidence} rules={f.rules} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {view.unchecked.length > 0 && (
        <section aria-labelledby="unchecked-title" className="unchecked">
          <h2 id="unchecked-title">{t('uncheckedTitle')}</h2>
          <ul>
            {view.unchecked.map((u) => (
              <li key={u.id}>{u.text}</li>
            ))}
          </ul>
          <p className="fineprint">{t('uncheckedNote')}</p>
        </section>
      )}

      <section aria-labelledby="next-title" className="next">
        <h2 id="next-title">{t('nextTitle')}</h2>
        <ol>
          {view.nextSteps
            .filter((s) => s.id !== 'already-paid')
            .map((s) => (
              <li key={s.id}>
                {s.text}{' '}
                {s.href && (
                  <a href={s.href} target="_blank" rel="noopener noreferrer">
                    {t('openLink')}
                  </a>
                )}
                {s.phone && (
                  <a href={`tel:${s.phone.replace(/\s+/g, '')}`}>{t('call', { phone: s.phone })}</a>
                )}
              </li>
            ))}
        </ol>
        <Actions view={view} />
      </section>

      <details className="read">
        <summary>{t('readTitle')}</summary>
        {view.extracted.segments.map((s) => (
          <pre key={s.id} className="transcript">
            {s.text}
          </pre>
        ))}
        {view.extracted.identifiers.length > 0 && (
          <>
            <h3>{t('identifiersTitle')}</h3>
            <dl className="identifiers">
              {view.extracted.identifiers.map((g) => (
                <div key={g.kind}>
                  <dt>{KIND_LABELS[g.kind]?.[lang] ?? g.kind}</dt>
                  <dd>
                    {g.values.map((v) => (
                      <code key={v} className="ident">
                        {v}
                      </code>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </details>

      <details className="read">
        <summary>{t('sourcesChecked')}</summary>
        <ul className="ledger">
          {view.sources.map((s) => (
            <li key={s.id} className="ledger__row">
              <span>
                {s.name}
                {s.isFixture ? ` (${t('sourcesFixture')})` : ''}
              </span>
              <span>
                {s.status === 'ok'
                  ? t('statusOk')
                  : s.status === 'skipped'
                    ? t('statusSkipped')
                    : t('statusUnavailable')}
                {s.status === 'ok'
                  ? `, ${s.mode === 'live' ? t('modeLive') : s.mode === 'static' ? t('modeStatic') : t('modeSnapshot')}`
                  : ''}
                {s.asOf ? `, ${t('sourcesUpdated', { date: formatDate(s.asOf, lang) })}` : ''}
              </span>
            </li>
          ))}
        </ul>
      </details>

      <p className="disclaimer">{t('disclaimer')}</p>
    </article>
  );
}
