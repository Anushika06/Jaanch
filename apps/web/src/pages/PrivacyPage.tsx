import { useApp } from '../context';

const CONTENT = {
  en: [
    [
      'What we keep',
      'The report (what the message claimed and what official records showed) is kept for {days} days so you can open the link, then deleted automatically. You can delete it earlier from the report page, or by sending DELETE on WhatsApp.',
    ],
    [
      'What we don’t keep',
      'Screenshots and voice notes are deleted as soon as they have been read. We never store your phone number or IP address — only a one-way code used to prevent abuse. On WhatsApp, your own number is removed from the message text before it is checked.',
    ],
    [
      'Who reads your message',
      'An AI model reads the text and screenshots to list the claims. In this prototype that model runs on NVIDIA’s hosted API, whose terms allow NVIDIA to log inputs. Please avoid sending images that show your own bank or personal details.',
    ],
    [
      'What we check against',
      'SEBI’s public registers of intermediaries, SEBI’s regulations and circulars, RBI’s Alert List, and public domain registration records (RDAP). We do not open links from your message.',
    ],
    [
      'What Jaanch is not',
      'Jaanch is not investment advice and does not decide whether anyone is a fraudster. It shows what official records say about the claims in a message.',
    ],
  ],
  hi: [
    [
      'हम क्या रखते हैं',
      'रिपोर्ट (मैसेज ने क्या दावा किया और आधिकारिक रिकॉर्ड में क्या मिला) {days} दिन तक रखी जाती है ताकि आप लिंक खोल सकें, फिर अपने-आप मिट जाती है। आप इसे रिपोर्ट पेज से या WhatsApp पर DELETE भेजकर पहले भी मिटा सकते हैं।',
    ],
    [
      'हम क्या नहीं रखते',
      'स्क्रीनशॉट और वॉइस नोट पढ़ते ही मिटा दिए जाते हैं। हम आपका फ़ोन नंबर या IP पता कभी नहीं रखते — दुरुपयोग रोकने के लिए सिर्फ़ एक एकतरफ़ा कोड। WhatsApp पर, जाँच से पहले मैसेज से आपका अपना नंबर हटा दिया जाता है।',
    ],
    [
      'आपका मैसेज कौन पढ़ता है',
      'एक AI मॉडल टेक्स्ट और स्क्रीनशॉट पढ़कर दावों की सूची बनाता है। इस प्रोटोटाइप में वह मॉडल NVIDIA की होस्टेड API पर चलता है, जिसकी शर्तों के अनुसार NVIDIA इनपुट लॉग कर सकता है। कृपया अपनी बैंक या निजी जानकारी वाली तस्वीरें न भेजें।',
    ],
    [
      'हम किससे जाँचते हैं',
      'SEBI की इंटरमीडियरी की सार्वजनिक सूचियाँ, SEBI के नियम और सर्कुलर, RBI की अलर्ट सूची, और डोमेन रजिस्ट्रेशन के सार्वजनिक रिकॉर्ड (RDAP)। हम आपके मैसेज के लिंक नहीं खोलते।',
    ],
    [
      'Jaanch क्या नहीं है',
      'Jaanch निवेश सलाह नहीं है और यह तय नहीं करता कि कोई धोखेबाज़ है या नहीं। यह बताता है कि आधिकारिक रिकॉर्ड मैसेज के दावों के बारे में क्या कहते हैं।',
    ],
  ],
};

export function PrivacyPage() {
  const { t, lang, meta } = useApp();
  return (
    <main id="main" className="page-prose">
      <h1>{t('privacyTitle')}</h1>
      {CONTENT[lang].map(([title, body]) => (
        <section key={title}>
          <h2>{title}</h2>
          <p>{body!.replace('{days}', String(meta?.reportTtlDays ?? 7))}</p>
        </section>
      ))}
    </main>
  );
}
