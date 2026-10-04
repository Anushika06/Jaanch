import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { api, type SourcesStatus } from '../api';
import { useApp } from '../context';
import { formatDate } from '../i18n';
import { IconDoc, IconScale, IconSearch, IconSpark } from './Icons';
import { Stamp } from './Stamp';

export function HowItWorks() {
  const { t } = useApp();
  const steps = [
    [t('how1Title'), t('how1'), <IconDoc key="i" size={22} />],
    [t('how2Title'), t('how2'), <IconSearch key="i" size={22} />],
    [t('how3Title'), t('how3'), <IconScale key="i" size={22} />],
    [t('how4Title'), t('how4'), <IconSpark key="i" size={22} />],
  ] as const;
  return (
    <section className="how" aria-labelledby="how-title">
      <h2 id="how-title">{t('howTitle')}</h2>
      <ol className="how__list">
        {steps.map(([title, body, icon], i) => (
          <li key={title} className="how__step">
            <span className="how__icon">{icon}</span>
            <span className="how__n">{t('stepLabel', { n: i + 1 })}</span>
            <h3>{title}</h3>
            <p>{body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function VerdictLegend() {
  const { t } = useApp();
  return (
    <section className="legend" aria-labelledby="legend-title">
      <h2 id="legend-title">{t('verdictsTitle')}</h2>
      <dl className="legend__grid">
        <div>
          <dt>
            <Stamp verdict="CONTRADICTED" label={t('stampContradicted')} size="sm" />
          </dt>
          <dd>{t('vContradicted')}</dd>
        </div>
        <div>
          <dt>
            <Stamp verdict="MATCHES" label={t('stampMatches')} size="sm" />
          </dt>
          <dd>{t('vMatches')}</dd>
        </div>
        <div>
          <dt>
            <Stamp verdict="NOT_FOUND" label={t('stampNotFound')} size="sm" />
          </dt>
          <dd>{t('vNotFound')}</dd>
        </div>
        <div>
          <dt>
            <Stamp verdict="CANT_CHECK" label={t('stampCantCheck')} size="sm" />
          </dt>
          <dd>{t('vCantCheck')}</dd>
        </div>
      </dl>
    </section>
  );
}

const CATEGORY_NAMES: Record<string, { en: string; hi: string }> = {
  RA: { en: 'Research Analysts', hi: 'रिसर्च एनालिस्ट' },
  IA: { en: 'Investment Advisers', hi: 'इन्वेस्टमेंट एडवाइज़र' },
  BROKER: { en: 'Stock Brokers', hi: 'स्टॉक ब्रोकर' },
  PMS: { en: 'Portfolio Managers', hi: 'पोर्टफ़ोलियो मैनेजर' },
  MF: { en: 'Mutual Funds', hi: 'म्यूचुअल फ़ंड' },
  MB: { en: 'Merchant Bankers', hi: 'मर्चेंट बैंकर' },
  AIF: { en: 'Alternative Investment Funds', hi: 'ऑल्टरनेटिव इन्वेस्टमेंट फ़ंड' },
  RTA: { en: 'Registrars & Transfer Agents', hi: 'रजिस्ट्रार और ट्रांसफ़र एजेंट' },
  DP: { en: 'Depository Participants', hi: 'डिपॉज़िटरी पार्टिसिपेंट' },
  DT: { en: 'Debenture Trustees', hi: 'डिबेंचर ट्रस्टी' },
  KRA: { en: 'KYC Registration Agencies', hi: 'KYC एजेंसियाँ' },
  CRA: { en: 'Credit Rating Agencies', hi: 'क्रेडिट रेटिंग एजेंसियाँ' },
};

function LiveBadge({ label }: { label: string }) {
  return (
    <span className="live">
      <span className="live__dot" aria-hidden="true" />
      {label}
    </span>
  );
}

function Tile({
  name,
  value,
  meta,
  fixture,
}: {
  name: string;
  value: ReactNode;
  meta?: ReactNode;
  fixture?: string | null;
}) {
  return (
    <li className="tile">
      <span className="tile__name">
        {name}
        {fixture && <em className="tag-fixture"> ({fixture})</em>}
      </span>
      <span className="tile__value">{value}</span>
      {meta && <span className="tile__meta">{meta}</span>}
    </li>
  );
}

export function SourcesPanel() {
  const { t, lang } = useApp();
  const [s, setS] = useState<SourcesStatus | null>(null);
  useEffect(() => {
    api
      .sources()
      .then(setS)
      .catch(() => setS(null));
  }, []);
  if (!s) return null;
  const locale = lang === 'hi' ? 'hi-IN' : 'en-IN';
  const order = ['RA', 'IA', 'BROKER', 'PMS', 'MF', 'MB', 'AIF', 'RTA', 'DP', 'DT', 'KRA', 'CRA'];
  const cats = [...s.sebi.categories].sort(
    (a, b) => order.indexOf(a.category) - order.indexOf(b.category),
  );
  const count = (n: number) => (
    <>
      <span className="tile__n">{n.toLocaleString(locale)}</span>{' '}
      <span className="tile__unit">{n === 1 ? t('recordWord') : t('recordsWord')}</span>
    </>
  );
  return (
    <section className="sources" aria-labelledby="sources-title">
      <h2 id="sources-title">{t('sourcesTitle')}</h2>
      <div className="sources__group">
        <h3 className="sources__org">
          <span>SEBI</span>
          {s.sebi.liveLookups && <LiveBadge label={t('sourcesLive')} />}
        </h3>
        <ul className="tiles">
          {cats.length === 0 && (
            <Tile
              name={lang === 'hi' ? 'इंटरमीडियरी सूचियाँ' : 'Intermediary registers'}
              value={s.sebi.liveLookups ? t('sourcesLive') : t('sourcesNone')}
            />
          )}
          {cats.map((c) => (
            <Tile
              key={c.category}
              name={CATEGORY_NAMES[c.category]?.[lang] ?? c.category}
              value={count(c.records)}
              meta={t('sourcesUpdated', { date: formatDate(c.asOf, lang) })}
              fixture={c.isFixture ? t('sourcesFixture') : null}
            />
          ))}
        </ul>
      </div>
      <div className="sources__group">
        <h3 className="sources__org">
          <span>{lang === 'hi' ? 'RBI और नियम' : 'RBI & rules'}</span>
        </h3>
        <ul className="tiles">
          <Tile
            name={
              lang === 'hi'
                ? 'RBI अलर्ट सूची (बिना अनुमति वाले फ़ॉरेक्स प्लैटफ़ॉर्म)'
                : 'RBI Alert List (unauthorised forex platforms)'
            }
            value={s.rbiAlertList.asOf ? count(s.rbiAlertList.entries) : t('sourcesNone')}
            meta={
              s.rbiAlertList.asOf
                ? t('sourcesUpdated', { date: formatDate(s.rbiAlertList.asOf, lang) })
                : undefined
            }
          />
          <Tile
            name={lang === 'hi' ? 'SEBI के नियम और सर्कुलर' : 'SEBI regulations and circulars'}
            value={<span className="tile__text">{t('rulesVerified')}</span>}
            meta={formatDate(s.rules.verifiedOn, lang)}
          />
          {s.rdap.enabled && (
            <Tile
              name={
                lang === 'hi'
                  ? 'वेबसाइट रजिस्ट्रेशन की तारीख़ (RDAP)'
                  : 'Website registration dates (RDAP)'
              }
              value={<LiveBadge label={t('sourcesLive')} />}
            />
          )}
        </ul>
      </div>
    </section>
  );
}

const PREVIEW = {
  en: {
    label: 'Example report',
    headline: '2 claims conflict with official records or SEBI rules',
    claims: [
      {
        verdict: 'CONTRADICTED' as const,
        stamp: 'Contradicted',
        statement: 'Returns are guaranteed: 30% a month.',
        note: 'SEBI rules don’t allow advisers to promise guaranteed returns.',
      },
      {
        verdict: 'NOT_FOUND' as const,
        stamp: 'Not found',
        statement: 'SEBI Registered Research Analyst, INH000099991.',
        note: 'No such number in any of SEBI’s 12 registers.',
      },
      {
        verdict: 'CANT_CHECK' as const,
        stamp: 'Can’t check',
        statement: 'Pay the joining fee to 98765•••••@ybl.',
        note: 'There is no public register of who owns a UPI ID.',
      },
    ],
    foot: 'Every verdict links to the official record it came from.',
  },
  hi: {
    label: 'उदाहरण रिपोर्ट',
    headline: '2 दावे आधिकारिक रिकॉर्ड या SEBI नियमों से मेल नहीं खाते',
    claims: [
      {
        verdict: 'CONTRADICTED' as const,
        stamp: 'रिकॉर्ड से उलट',
        statement: 'हर महीने 30% पक्का रिटर्न।',
        note: 'SEBI के नियम सलाहकारों को पक्के रिटर्न का वादा करने की अनुमति नहीं देते।',
      },
      {
        verdict: 'NOT_FOUND' as const,
        stamp: 'नहीं मिला',
        statement: 'SEBI रजिस्टर्ड रिसर्च एनालिस्ट, INH000099991।',
        note: 'SEBI की 12 सूचियों में ऐसा कोई नंबर नहीं।',
      },
      {
        verdict: 'CANT_CHECK' as const,
        stamp: 'जाँच नहीं हो सकी',
        statement: 'जॉइनिंग फ़ीस 98765•••••@ybl पर भेजें।',
        note: 'UPI ID किसका है, इसकी कोई सार्वजनिक सूची नहीं है।',
      },
    ],
    foot: 'हर नतीजा उस आधिकारिक रिकॉर्ड से जुड़ा है जिससे वह निकला।',
  },
};

const PREVIEW_TILTS = [-4, 2.5, -2];

/** A static, clearly labelled illustration of what a report looks like. Not a real check. */
export function HeroPreview() {
  const { lang } = useApp();
  const p = PREVIEW[lang];
  return (
    <figure className="preview" aria-label={p.label}>
      <div className="preview__strip" aria-hidden="true">
        <span>{p.label}</span>
        <span>jaanch</span>
      </div>
      <div className="preview__body">
        <p className="preview__headline">{p.headline}</p>
        <div className="summary__bar preview__bar" aria-hidden="true">
          <span className="summary__seg summary__seg--contradicted" style={{ flexGrow: 1 }} />
          <span className="summary__seg summary__seg--not_found" style={{ flexGrow: 1 }} />
          <span className="summary__seg summary__seg--cant_check" style={{ flexGrow: 1 }} />
        </div>
        <ul className="preview__claims">
          {p.claims.map((c, i) => (
            <li
              key={c.verdict}
              className={`preview__claim claim--${c.verdict.toLowerCase()}`}
              style={
                {
                  '--tilt': `${PREVIEW_TILTS[i]}deg`,
                  '--delay': `${i * 140}ms`,
                } as CSSProperties
              }
            >
              <Stamp verdict={c.verdict} label={c.stamp} size="sm" />
              <p className="preview__statement">{c.statement}</p>
              <p className="preview__note">{c.note}</p>
            </li>
          ))}
        </ul>
      </div>
      <figcaption className="preview__foot">{p.foot}</figcaption>
    </figure>
  );
}
