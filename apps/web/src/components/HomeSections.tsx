import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { api, type SourcesStatus } from '../api';
import { useApp } from '../context';
import { formatDate } from '../i18n';
import { Stamp } from './Stamp';

export function WhatsAppPanel() {
  const { t, meta } = useApp();
  const [qr, setQr] = useState<string | null>(null);
  const wa = meta?.whatsapp;

  useEffect(() => {
    if (!wa?.link) return;
    QRCode.toString(wa.link, {
      type: 'svg',
      margin: 0,
      color: { dark: '#18202E', light: '#00000000' },
    })
      .then(setQr)
      .catch(() => setQr(null));
  }, [wa?.link]);

  if (!wa?.enabled || !wa.number) return null;
  return (
    <section className="panel whatsapp" aria-labelledby="wa-title">
      <h2 id="wa-title">{t('waTitle')}</h2>
      <div className="whatsapp__body">
        <ol className="steps">
          <li>
            {wa.joinCode
              ? t('waStep1', { number: wa.number, join: wa.joinCode })
              : t('waStep1NoJoin', { number: wa.number })}
          </li>
          <li>{t('waStep2')}</li>
          <li>{t('waStep3')}</li>
        </ol>
        {qr && (
          <div
            className="whatsapp__qr"
            aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: qr }}
          />
        )}
      </div>
      {wa.link && (
        <a className="button-secondary" href={wa.link} target="_blank" rel="noopener noreferrer">
          {t('waOpen')}
        </a>
      )}
      {wa.sandbox && <p className="fineprint">{t('waSandbox')}</p>}
      {wa.testNumber && <p className="fineprint">{t('waTestNumber')}</p>}
    </section>
  );
}

export function HowItWorks() {
  const { t } = useApp();
  const steps = [
    [t('how1Title'), t('how1')],
    [t('how2Title'), t('how2')],
    [t('how3Title'), t('how3')],
    [t('how4Title'), t('how4')],
  ] as const;
  return (
    <section className="how" aria-labelledby="how-title">
      <h2 id="how-title">{t('howTitle')}</h2>
      <ol className="how__list">
        {steps.map(([title, body]) => (
          <li key={title}>
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
      <dl>
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
  const order = ['RA', 'IA', 'BROKER', 'PMS', 'MF', 'MB', 'AIF', 'RTA', 'DP', 'DT', 'KRA', 'CRA'];
  const cats = [...s.sebi.categories].sort(
    (a, b) => order.indexOf(a.category) - order.indexOf(b.category),
  );
  return (
    <section className="sources" aria-labelledby="sources-title">
      <h2 id="sources-title">{t('sourcesTitle')}</h2>
      <ul className="ledger">
        <li className="ledger__row ledger__row--head">
          <span>SEBI</span>
          <span>{s.sebi.liveLookups ? t('sourcesLive') : ''}</span>
        </li>
        {cats.length === 0 && (
          <li className="ledger__row">
            <span>{lang === 'hi' ? 'इंटरमीडियरी सूचियाँ' : 'Intermediary registers'}</span>
            <span>{s.sebi.liveLookups ? t('sourcesLive') : t('sourcesNone')}</span>
          </li>
        )}
        {cats.map((c) => (
          <li key={c.category} className="ledger__row">
            <span>
              {CATEGORY_NAMES[c.category]?.[lang] ?? c.category}
              {c.isFixture && <em className="tag-fixture"> ({t('sourcesFixture')})</em>}
            </span>
            <span>
              {c.records === 1
                ? t('sourcesRecordOne')
                : t('sourcesRecords', {
                    n: c.records.toLocaleString(lang === 'hi' ? 'hi-IN' : 'en-IN'),
                  })}
              , {t('sourcesUpdated', { date: formatDate(c.asOf, lang) })}
            </span>
          </li>
        ))}
        <li className="ledger__row ledger__row--head">
          <span>RBI</span>
          <span />
        </li>
        <li className="ledger__row">
          <span>
            {lang === 'hi'
              ? 'अलर्ट सूची (बिना अनुमति वाले फ़ॉरेक्स प्लैटफ़ॉर्म)'
              : 'Alert List (unauthorised forex platforms)'}
          </span>
          <span>
            {s.rbiAlertList.asOf
              ? `${s.rbiAlertList.entries === 1 ? t('sourcesRecordOne') : t('sourcesRecords', { n: s.rbiAlertList.entries })}, ${t('sourcesUpdated', { date: formatDate(s.rbiAlertList.asOf, lang) })}`
              : t('sourcesNone')}
          </span>
        </li>
        <li className="ledger__row ledger__row--head">
          <span>{lang === 'hi' ? 'नियम' : 'Rules'}</span>
          <span />
        </li>
        <li className="ledger__row">
          <span>{t('sourcesRules', { date: formatDate(s.rules.verifiedOn, lang) })}</span>
          <span />
        </li>
        {s.rdap.enabled && (
          <li className="ledger__row">
            <span>
              {lang === 'hi'
                ? 'वेबसाइट रजिस्ट्रेशन की तारीख़ (RDAP)'
                : 'Website registration dates (RDAP)'}
            </span>
            <span>{t('sourcesLive')}</span>
          </li>
        )}
      </ul>
    </section>
  );
}
