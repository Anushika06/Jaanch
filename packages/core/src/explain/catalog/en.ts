/**
 * English templates. This object is the source of truth for every reason code: the Hindi
 * catalog must provide the same keys (enforced by the type checker). Placeholders `{name}` are
 * filled with values from evidence or the message; values starting with "@" are looked up in
 * the dictionary below. Wording rules: plain words, short sentences, "the message says… / the
 * official record shows…", never a verdict on a person or firm.
 */
export const EN = {
  // ---------------------------------------------------------------- claim statements
  CLAIM_REG_NUMBER_NAME: '{holderName} is registered with SEBI ({category}) under number {regNo}.',
  CLAIM_REG_NUMBER: 'The sender is registered with SEBI ({category}) under number {regNo}.',
  CLAIM_REG_NAME: '{holderName} is registered with SEBI ({category}).',
  CLAIM_REG_BARE: 'The sender is registered with SEBI ({category}).',
  CLAIM_IDENTITY: 'This message is from {orgName}.',
  CLAIM_ENDORSEMENT: '{authority} has approved this {object}.',
  CLAIM_RETURNS_RATE: 'Returns are {kind}: {percent}% {period}.',
  CLAIM_RETURNS: 'Returns are {kind}.',
  CLAIM_PAYMENT_UPI: 'Payment should go to UPI ID {upi}.',
  CLAIM_PAYMENT_BANK: 'Payment should go to bank account {account}.',
  CLAIM_PAYMENT: 'Payment should be made by {method}.',
  CLAIM_APP_LINK: 'Install the app from {domain}.',
  CLAIM_APP: 'Install the app “{appName}”.',
  CLAIM_APP_GENERIC: 'Install an app shared in the message.',
  CLAIM_ACCESS: 'You can get {kind}.',

  // ---------------------------------------------------------------- registration verdicts
  REG_MATCH:
    "SEBI's register lists {regNo} as a {category} registered to {officialName}, valid until {validTo}. The name in the message matches.",
  REG_MATCH_PERPETUAL:
    "SEBI's register lists {regNo} as a current {category} registration of {officialName}, with no end date. The name in the message matches.",
  REG_NAME_FOUND:
    "No registration number was given, but SEBI's register has a {category} named {officialName} ({regNo}).",
  REG_BELONGS_TO_OTHER:
    "The message says {regNo} belongs to {claimedName}. SEBI's register shows {regNo} is registered to {officialName} ({officialCity}) — a different name.",
  REG_INACTIVE:
    'SEBI lists registration {regNo} ({officialName}) as {status}. It is not a current registration.',
  REG_EXPIRED:
    "SEBI's register shows registration {regNo} ({officialName}) was valid only until {validTo}.",
  REG_NOT_IN_REGISTER:
    "We searched SEBI's register ({registers}; updated {asOf}) and found no registration {regNo}.",
  REG_FORMAT_INVALID:
    '{regNo} does not match the format SEBI uses ({shape}). No SEBI registration has this number.',
  REG_NAME_NOT_FOUND:
    "We searched SEBI's register ({registers}; updated {asOf}) and found no registered intermediary named {claimedName}.",
  REG_NO_DETAILS:
    "The message says the sender is SEBI-registered ({category}) but gives no registration number or registered name, so this can't be checked.",
  REG_UNCLEAR_NUMBER:
    "The registration number ({regNo}) wasn't clear enough to read with certainty, so we didn't draw a conclusion. Please check the number in the original message.",
  REG_SOURCE_UNAVAILABLE:
    "SEBI's register couldn't be reached to check {regNo}. Please try again later.",
  REG_SOURCE_UNAVAILABLE_NAME:
    "SEBI's register couldn't be reached to check {claimedName}. Please try again later.",
  REG_SCHEME_NOT_COVERED:
    "{regNo} looks like a {scheme} number. Jaanch doesn't check that register yet.",
  REG_NAME_AMBIGUOUS:
    "SEBI's register has {count} entries with names like {claimedName}, so we can't tell which one this is.",
  REG_REAL_SENDER_UNKNOWN:
    "{regNo} is a real SEBI registration. It belongs to {officialName} ({category}). The message doesn't make clear who is sending it, so confirm you are really dealing with {officialName}.",
  REG_NAME_SIMILAR:
    '{regNo} is registered to {officialName}. The message uses a similar but different name, {claimedName}. We can’t tell if they are the same.',
  REG_NAME_MISMATCH_UNCERTAIN:
    "{regNo} is registered to {officialName}, but the message seems to use the name {claimedName}. Parts of the message weren't clear enough to be sure.",
  REG_NAME_MISMATCH_INFERRED:
    "{regNo} is registered to {officialName}. The message also mentions {claimedName} but doesn't clearly say the number is theirs, so confirm who you are dealing with.",

  // ---------------------------------------------------------------- caveats
  CAVEAT_NO_NUMBER_GIVEN:
    "The message didn't show a registration number, which registered advisers and analysts are required to show.",
  CAVEAT_CATEGORY_DIFFERS:
    'The message calls it a {claimedCategory}, but SEBI lists it as a {actualCategory}.',
  CAVEAT_POSSIBLE_READING:
    'If the number is actually {variant}, it belongs to {officialName}. Check the original message.',
  CAVEAT_CLAIMED_NAME_REGISTERED_ELSEWHERE:
    "Note: SEBI's register does have an entity named {claimedName}, under a different number ({otherRegNo}).",
  CAVEAT_FIXTURE: 'Development test data was used for this check — not the official register.',
  CAVEAT_SNAPSHOT_STALE:
    'Our copy of the register was last updated {asOf}; a very recent change may be missing.',
  CAVEAT_CONTACTS_CAN_BE_COPIED:
    "Matching contact details are a good sign, but details can be copied. If anything feels off, call the number on SEBI's record yourself.",

  // ---------------------------------------------------------------- identity verdicts
  ID_CONTACTS_MATCH:
    "The contact details in the message ({channels}) match {officialName}'s official SEBI record.",
  ID_CONTACTS_NOT_ON_RECORD:
    "The contact details in the message ({channels}) are not the ones on {officialName}'s official SEBI record. We can't confirm this message comes from {officialName}.",
  ID_NO_CONTACTS:
    "{officialName} is SEBI-registered, but the message has no contact details we could compare with the official record. We can't confirm it comes from them.",
  ID_NOT_IN_REGISTER:
    'We found no SEBI-registered intermediary named {orgName} (register updated {asOf}).',
  ID_NOT_CHECKABLE:
    "We can't check who {orgName} is — the message doesn't present it as a SEBI-registered intermediary.",
  ID_SOURCE_UNAVAILABLE: "SEBI's register couldn't be reached to check {orgName}.",
  ID_AMBIGUOUS:
    "SEBI's register has {count} entries matching {orgName}, so we can't tell which one this is.",
  ID_SEBI_EMAIL_MISMATCH:
    'The message presents itself as coming from SEBI but uses the email {email}. SEBI says its genuine emails come only from addresses ending in @sebi.gov.in.',
  ID_REGULATOR_UNVERIFIED:
    "The message presents itself as coming from {orgName}. We can't verify that. Regulators publish their official contact channels on their own websites.",

  // ---------------------------------------------------------------- returns
  RETURNS_BY_REGISTERED:
    "The message claims SEBI registration ({category}) and also promises guaranteed returns. SEBI's rules do not allow registered advisers, analysts or brokers to promise assured returns.",
  RETURNS_UNVERIFIABLE:
    'No one can verify a promised future return. SEBI says assured, guaranteed or fixed-return schemes are prohibited by law.',
  RETURNS_DEPOSIT:
    "This looks like a deposit product (such as a fixed deposit). Jaanch doesn't check deposit rates — confirm the rate on the bank's official website.",

  // ---------------------------------------------------------------- endorsements
  ENDORSE_SEBI_DOES_NOT_APPROVE:
    'The message says SEBI approved this {object}. SEBI does not recommend or approve specific investments, tips or schemes.',
  ENDORSE_EXCHANGES_DO_NOT_ENDORSE:
    'The message says {authority} approved this {object}. Stock exchanges and SEBI do not endorse investments or trading schemes.',
  ENDORSE_APP_OR_GROUP:
    "The message says {authority} approved this {object}. We can't confirm this. SEBI has warned about fake 'SEBI certificates' and fake apps shared on social media.",
  ENDORSE_NOT_CHECKABLE: "The message claims approval by {authority}. We can't check this.",

  // ---------------------------------------------------------------- payments
  UPI_NOT_VALIDATED:
    'The message asks for payment to {upi} for a SEBI-registered service ({category}). SEBI requires registered intermediaries to collect UPI payments through validated UPI IDs ending in “@valid…”, and their old UPI IDs were to be discontinued. {upi} is not such an ID.',
  UPI_OWNER_UNKNOWN:
    "We can't check who owns {upi}. Before you pay, your UPI app shows the account holder's name — check it.",
  UPI_VALIDATED_CHECK:
    '{upi} has the shape of a SEBI-validated UPI ID. Confirm on SEBI Check that it belongs to the firm you expect; the payment screen should show a white thumbs-up in a green triangle.',
  BANK_OWNER_UNKNOWN:
    "We can't check who owns this bank account. SEBI Check can verify bank accounts of registered intermediaries.",
  PAYMENT_QR:
    "We can't check a QR code from here. SEBI Check can read a QR code and tell you whether it belongs to a registered intermediary.",
  PAYMENT_CRYPTO: "We can't check crypto payments.",
  PAYMENT_OTHER: "We can't check where this payment goes.",

  // ---------------------------------------------------------------- apps
  APP_SIDELOAD:
    "The message asks you to install an app from {domain}, not from an official app store. We can't check this app.",
  APP_NO_LINK: "We can't check this app.",
  APP_STORE_CHECK_DEVELOPER:
    "The link goes to {store}. Check that the developer name on the store page matches the registered firm's name.",

  // ---------------------------------------------------------------- special access
  ACCESS_FPI_NOT_FOR_RESIDENTS:
    "The message offers an FPI (foreign investor) account. SEBI says the FPI route is not available to resident Indians (with limited exceptions), and such schemes do not have SEBI's endorsement.",
  ACCESS_CAUTIONED:
    'The message offers {kind}. SEBI and the stock exchanges have warned that offers like this on social media are used to defraud investors.',
  ACCESS_UNVERIFIABLE: "The message offers {kind}. We can't check this.",

  // ---------------------------------------------------------------- findings
  F_NO_REG_DETAILS:
    "Registered advisers and research analysts must show their SEBI-registered name and registration number in their messages (or link to an official website that shows them). This message doesn't show a registration number.",
  F_CATEGORY_DIFFERS:
    'The message calls {regNo} a {claimedCategory} registration, but SEBI lists it as a {actualCategory}.',
  F_DOMAIN_LOOKALIKE:
    "{domain} looks like {officialDomain} (the domain in {officialName}'s official record) but is a different website.",
  F_RETURN_RATE_MATH:
    'For scale: {percent}% {period} adds up to about {annualPercent}% in a year, even without compounding.',
  F_GUARANTEED_RETURNS:
    'The message promises guaranteed or risk-free returns (“{quote}”). SEBI says assured, guaranteed or fixed-return schemes are prohibited by law.',
  F_UPI_PERSONAL:
    '{upi} looks like a personal UPI ID (made from a mobile number), not a business collection account.',
  F_UPI_PERSONAL_PATTERN: 'The message asks for payment to what looks like a personal account.',
  F_UPI_SUFFIX_DIFFERS:
    '{upi} is a validated UPI ID for a {suffixLabel}, but the message presents a {category}.',
  F_CRYPTO_PAYMENT: 'The message asks for payment in crypto (such as USDT or Bitcoin).',
  F_APP_SIDELOAD:
    'Installing apps from links in messages is risky. SEBI advises using only authentic trading apps of SEBI-registered intermediaries.',
  F_SPECIAL_ACCESS:
    'Offers of {kind} through WhatsApp or Telegram match lures that SEBI and the stock exchanges have publicly warned about.',
  F_URGENCY:
    'The message pressures you to act quickly (“{quote}”). Take your time — a genuine offer can wait while you verify it.',
  F_SECRECY:
    "The message asks for secrecy or offers 'insider'/'operator' tips (“{quote}”). Trading on unpublished price-sensitive information is prohibited under SEBI's insider-trading regulations.",
  F_CONTACT_SHIFT:
    "The message moves you to a group or private chat (“{quote}”). SEBI has warned about investment frauds run through WhatsApp and Telegram 'VIP' groups.",
  F_OTP_REMOTE:
    'The message asks for an OTP or a screen-sharing/remote-access app (“{quote}”). SEBI-registered advisers and analysts must never ask for your login details or OTPs. Never share them.',
  F_PAY_TO_WITHDRAW:
    "The message asks you to pay before you can withdraw money (“{quote}”). Don't send more money to 'unlock' a withdrawal — report it instead.",
  F_PROFIT_PROOF:
    "The message relies on profit screenshots or members' earnings (“{quote}”). These can't be verified, and registered advisers and analysts may not advertise unverified past performance.",
  F_ACCURACY_CLAIM:
    "The message advertises an accuracy or success rate (“{quote}”). SEBI's rules do not allow registered advisers and analysts to advertise accuracy percentages or unverified past performance.",
  F_URL_SHORTENER: 'The link uses a link shortener ({domain}), which hides where it really leads.',
  F_URL_IP_HOST: 'The link goes to a bare internet address ({host}) instead of a named website.',
  F_DOMAIN_NEW: 'The website {domain} was registered only {days} days ago (on {date}).',
  F_RBI_ALERT:
    "{name} appears on RBI's Alert List of entities not authorised to deal in forex or run forex trading platforms (list updated {asOf}). Matched: {query}.",
  F_FOREIGN_NUMBER:
    'The message uses a foreign phone number ({phone}, {country}) while presenting a SEBI-registered Indian business.',

  // ---------------------------------------------------------------- could not check
  U_SOURCE_DOWN: "{source} couldn't be reached, so related checks were skipped.",
  U_PHONE_OWNER: "Who owns the phone number(s) — there's no public register we can check.",
  U_GROUP_LINKS: "Who runs the WhatsApp/Telegram groups or channels — we can't check that.",
  U_URL_CONTENT: 'What the links lead to — Jaanch never opens links found in messages.',
  U_FUTURE_RETURNS:
    'Whether any promised return will actually be paid — no one can check the future.',
  U_AUDIO_UNSUPPORTED:
    "The voice note — voice notes can't be checked yet. Send a screenshot or the text instead.",
  U_UNREADABLE_PART: "One {kind} couldn't be read ({why}).",
  U_DOMAIN_AGE: "When {domain} was registered — the domain registry couldn't be reached.",
  U_MODEL_UNAVAILABLE:
    'The AI reader was unavailable, so only exact patterns (numbers, IDs, links and key phrases) were checked — some claims may have been missed.',

  // ---------------------------------------------------------------- evidence titles
  EV_SEBI_RECORD: 'SEBI register entry: {regNo} ({category})',
  EV_SEBI_ABSENT: 'SEBI register search: no match for {query}',
  EV_SEBI_INACTIVE: 'SEBI list of inactive registrations: {regNo} — {status}',
  EV_RDAP: 'Domain registration record: {domain}',
  EV_RBI_ALERT: 'RBI Alert List entry: {name}',

  // ---------------------------------------------------------------- rules
  RULE_RA_IA_NO_ASSURED_RETURNS:
    'SEBI-registered research analysts and investment advisers may not promise or imply assured, guaranteed or risk-free returns.',
  RULE_BROKER_NO_GUARANTEED_RETURN_SCHEMES:
    'Stock brokers must not run schemes of indicative, guaranteed, fixed or periodic returns.',
  RULE_ASSURED_RETURN_SCHEMES_PROHIBITED:
    'Assured, guaranteed or fixed-return schemes are prohibited by law (SEBI).',
  RULE_RA_IA_NO_ACCURACY_CLAIMS:
    'Registered analysts and advisers may not advertise accuracy percentages, target returns or unverified past performance.',
  RULE_REGISTRATION_DETAILS_IN_COMMUNICATIONS:
    'Registered analysts and advisers must show their SEBI-registered name and registration number in advertisements and messages, or link to an official website that shows them.',
  RULE_SEBI_DOES_NOT_APPROVE_SECURITIES:
    'SEBI does not recommend or approve securities, and SEBI registration does not guarantee performance or returns.',
  RULE_EXCHANGES_SEBI_DO_NOT_ENDORSE:
    'Stock exchanges and SEBI do not guarantee or endorse the merits of trading.',
  RULE_VALIDATED_UPI_FOR_INTERMEDIARIES:
    'SEBI-registered intermediaries must collect UPI payments from investors through validated UPI IDs (name.category@valid<bank>) that can be checked on SEBI Check.',
  RULE_RA_IA_NEVER_ASK_OTP:
    'Registered analysts and advisers must never ask for your login details or OTPs.',
  RULE_RA_IA_NO_CLIENT_FUNDS:
    'Investment advisers may not take your money or securities into their own account; do not give money for investment to an adviser or analyst.',
  RULE_FPI_ROUTE_NOT_FOR_RESIDENTS:
    'The FPI (foreign portfolio investor) route is not available to resident Indians, except in limited cases.',
  RULE_CAUTION_SOCIAL_MEDIA_LURES:
    "SEBI has cautioned about social-media frauds offering 'institutional accounts', discounted IPOs or block trades, 'sure-shot' IPO allotment, assured returns and fake SEBI certificates.",
  RULE_CAUTION_VIP_GROUPS:
    "SEBI has cautioned about stock-market frauds run through WhatsApp 'VIP groups' and impersonation.",
  RULE_CAUTION_FAKE_INSTITUTIONAL_ACCOUNTS:
    "The stock exchanges have warned about fake 'FPI/FII sub-accounts' and 'institutional accounts' and pre-IPO 'assured profits'.",
  RULE_SEBI_EMAIL_DOMAIN:
    'Genuine emails from SEBI come only from addresses ending in @sebi.gov.in.',

  // ---------------------------------------------------------------- headlines
  H_REG_NOT_THEIRS: "The registration number is real. It just isn't theirs.",
  H_CONTRADICTED_ONE: '1 claim in this message conflicts with official records or SEBI rules.',
  H_CONTRADICTED_MANY:
    '{count} claims in this message conflict with official records or SEBI rules.',
  H_NOT_FOUND: "Some claims in this message couldn't be found in official records.",
  H_WARNINGS: 'No claim was directly contradicted, but there are serious warning signs.',
  H_ALL_MATCH:
    "What we could check matches official records. Some things can't be checked — read below.",
  H_ONLY_CANT_CHECK: "We couldn't check the claims in this message. Read why below.",
  H_NO_CLAIMS: "We didn't find investment claims to check in this message.",

  // ---------------------------------------------------------------- next steps
  NS_PAUSE:
    'Pause before paying. The checks in this report found problems with what this message claims.',
  NS_CONTACT_OFFICIAL:
    "To confirm, contact {officialName} using the details on SEBI's record ({contact}) — not the numbers in this message.",
  NS_SEBI_CHECK:
    'Check any UPI ID, QR code or bank account on SEBI Check before paying a SEBI-registered firm.',
  NS_UPI_NAME:
    "Before you pay, your UPI app shows the receiver's name — make sure it matches the registered firm.",
  NS_OFFICIAL_APP:
    'Install trading apps only from official app stores, and check the developer is the registered firm.',
  NS_VERIFY_SEBI_SITE: "You can search SEBI's list of registered intermediaries yourself.",
  NS_REPORT_CHAKSHU:
    'Report suspicious calls, SMS or WhatsApp messages on Sanchar Saathi (Chakshu).',
  NS_ALREADY_PAID: 'Already paid? Act now — see what to do.',
  NS_SEBI_HELPLINE: "Questions? SEBI's toll-free helpline: 1800 266 7575 or 1800 22 7575.",

  // ---------------------------------------------------------------- "I already paid"
  RC_CALL_1930:
    'Call 1930 right away — the national helpline for reporting financial fraud. Report as soon as you can.',
  RC_CYBERCRIME:
    'File a complaint at cybercrime.gov.in. You can also report the phone numbers, UPI IDs and links used.',
  RC_BANK:
    "Tell your bank it was a fraud. Use the number on your card, passbook or the bank's official app — not one from a search result or the message. Ask them to stop or trace the payment.",
  RC_UPI_COMPLAINT:
    "Raise a 'fraudulent transaction' complaint in your UPI app or on NPCI's UPI Help. NPCI can't reverse payments by itself, so report to 1930 as well.",
  RC_EVIDENCE:
    "Keep everything: screenshots, the transaction ID (UTR), phone numbers, UPI IDs and links. Don't delete the chat.",
  RC_SCORES:
    'If a SEBI-registered firm was involved, complain to the firm first, then on SEBI SCORES.',
  RC_RECOVERY_SCAMS:
    'Be careful of anyone who offers to recover your money for a fee — that is a common follow-up fraud.',
  RC_SUMMARY: 'Copy the evidence summary and attach it to your complaint.',

  // ---------------------------------------------------------------- shared UI text
  UI_REPORT_TITLE: 'Jaanch report',
  UI_CLAIMS: 'What the message claims',
  UI_WARNINGS: 'Warning signs',
  UI_UNCHECKED: 'Could not check',
  UI_NEXT: 'What to do next',
  UI_RECOVERY: 'Already paid? Do this now',
  UI_FULL_REPORT: 'Full report',
  UI_SOURCES: 'Checked against',
  UI_IDENTIFIERS: 'Details from the message (keep these for any complaint)',
  UI_DISCLAIMER:
    'Jaanch reports what official records and SEBI rules show. It is not investment advice and not a legal finding about anyone.',
  UI_ABSENCE_NOTE:
    "Not finding a problem doesn't mean something is safe. 'Could not check' means exactly that.",
  UI_SUMMARY_TITLE: 'Evidence summary — Jaanch',
  UI_REPORT_ID: 'Report ID',
  UI_CREATED: 'Checked on',
  UI_LINK: 'Report link',
  UI_VALID_UNTIL: 'available until {date}',
  UI_OFFICIAL_RECORD_SHOWS: 'Official record shows',
  UI_MESSAGE_SAYS: 'Message says',
  UI_RULE: 'Rule',
  UI_SOURCE: 'Source',
  UI_AS_OF: 'as of {date}',
  UI_RETRIEVED: 'retrieved {date}',
  UI_FIXTURE_BANNER: 'DEVELOPMENT DATA — these results use test fixtures, not official records.',

  // ---------------------------------------------------------------- WhatsApp conversation
  WA_WELCOME:
    "Namaste! I'm Jaanch. Forward me an investment message, screenshot, link or voice note, and I'll check its claims against official records (SEBI registers and rules).\n\nI don't give investment advice. Reply HINDI for Hindi.",
  WA_HELP:
    'How to use Jaanch:\n• Forward the message or send screenshots (up to 5)\n• Wait about 30 seconds for the report\n• Reply PAID if you already sent money\n• Reply HINDI / ENGLISH to switch language\n• Reply DELETE to erase your data',
  WA_ACK: 'Checking… This takes about 30 seconds.',
  WA_ACK_COLLECTING:
    'Got it. Send any more screenshots now — I will start checking in a few seconds.',
  WA_LANG_SET: 'Okay, I will reply in English.',
  WA_DELETED: 'Done. Your reports and settings with Jaanch have been deleted.',
  WA_ERROR:
    'Sorry, something went wrong while checking. Please send the message again in a minute.',
  WA_RATE_LIMITED: "You've sent a lot of checks recently. Please wait a little and try again.",
  WA_NOTHING_TO_CHECK:
    "I couldn't find investment claims to check here. Forward the investment message or a screenshot of it.",
  WA_PAID_NO_REPORT:
    'If you already paid someone you now suspect, act now:\n1. Call 1930 (national helpline for financial fraud)\n2. Complain at cybercrime.gov.in\n3. Tell your bank through its official app or the number on your card',
  WA_UNSUPPORTED_MEDIA:
    "I can read text, screenshots (JPG/PNG) and voice notes. This file type can't be checked.",
  WA_TOO_LARGE: 'That file is too large to check. Please send a screenshot instead.',
  WA_PRIVACY:
    'Privacy: screenshots and voice notes are deleted right after reading. Reports are kept for {days} days so you can open the link, then deleted. Reply DELETE anytime.',
  WA_MENU: 'Reply PAID if you already sent money · HINDI for Hindi · HELP for help',
} as const;

export type ReasonCode = keyof typeof EN;

/** Values referenced from params with an "@" prefix (e.g. "@cat.RA"). */
export const DICT_EN: Record<string, string> = {
  'cat.RA': 'Research Analyst',
  'cat.IA': 'Investment Adviser',
  'cat.BROKER': 'Stock Broker',
  'cat.PMS': 'Portfolio Manager',
  'cat.MB': 'Merchant Banker',
  'cat.MF': 'Mutual Fund',
  'cat.AIF': 'Alternative Investment Fund',
  'cat.RTA': 'Registrar & Share Transfer Agent',
  'cat.DP': 'Depository Participant',
  'cat.DT': 'Debenture Trustee',
  'cat.KRA': 'KYC Registration Agency',
  'cat.CRA': 'Credit Rating Agency',
  'cat.OTHER': 'other category',
  'cat.UNKNOWN': 'type not stated',
  'scheme.SEBI_RA': 'SEBI research analyst',
  'scheme.SEBI_IA': 'SEBI investment adviser',
  'scheme.SEBI_BROKER': 'SEBI stock broker',
  'scheme.SEBI_PMS': 'SEBI portfolio manager',
  'scheme.SEBI_MB': 'SEBI merchant banker',
  'scheme.SEBI_RTA': 'SEBI registrar/transfer agent',
  'scheme.SEBI_DT': 'SEBI debenture trustee',
  'scheme.SEBI_DP': 'SEBI depository participant',
  'scheme.SEBI_MF': 'SEBI mutual fund',
  'scheme.SEBI_AIF': 'SEBI alternative investment fund',
  'scheme.SEBI_OTHER': 'SEBI',
  'scheme.AMFI_ARN': 'AMFI mutual-fund distributor (ARN)',
  'period.day': 'per day',
  'period.week': 'per week',
  'period.month': 'per month',
  'period.year': 'per year',
  'period.trade': 'per trade',
  'period.unspecified': '',
  'kind.guaranteed': 'guaranteed',
  'kind.assured': 'assured',
  'kind.fixed': 'fixed',
  'kind.risk_free': 'risk-free',
  'kind.no_loss': 'loss-free',
  'obj.product': 'product',
  'obj.tip': 'tip',
  'obj.scheme': 'scheme',
  'obj.app': 'app',
  'obj.returns': 'return',
  'obj.group': 'group',
  'auth.SEBI': 'SEBI',
  'auth.RBI': 'RBI',
  'auth.NSE': 'NSE',
  'auth.BSE': 'BSE',
  'auth.GOVT': 'the government',
  'access.institutional_account': "an 'institutional trading account'",
  'access.fpi_account': 'an FPI/foreign-investor account',
  'access.pre_ipo': "'pre-IPO' shares",
  'access.ipo_allotment': 'guaranteed IPO allotment',
  'access.otc': "'OTC' trades",
  'access.block_deal': 'discounted block deals',
  'access.vip_group': "a 'VIP' group membership",
  'store.play': 'Google Play',
  'store.apple': 'the Apple App Store',
  'regstatus.Cancelled': 'cancelled',
  'regstatus.Surrendered': 'surrendered',
  'regstatus.Expired': 'expired',
  'regstatus.Suspended': 'suspended',
  'src.sebi_intermediaries': "SEBI's register of intermediaries",
  'src.rbi_alert_list': "RBI's Alert List",
  'src.domain_rdap': 'The domain registry (RDAP)',
  'src.jaanch_rules': "Jaanch's rule table (SEBI regulations and circulars)",
  'part.image': 'screenshot',
  'part.audio': 'voice note',
  'part.text': 'text',
  'part.url': 'link',
  'unread.unsupported': 'not supported',
  'unread.reader_unavailable': 'reader unavailable',
  'unread.unreadable': 'too unclear',
  'unread.too_large': 'too large',
  'unread.error': 'an error',
  'word.perpetual': 'no end date (perpetual)',
  'word.all_registers': 'all 12 intermediary registers',
  'method.upi': 'UPI',
  'method.bank': 'bank transfer',
  'method.qr': 'QR code',
  'method.crypto': 'crypto',
  'method.other': 'another method',
  'verdict.CONTRADICTED': 'CONTRADICTED',
  'verdict.MATCHES': 'MATCHES',
  'verdict.NOT_FOUND': 'NOT FOUND',
  'verdict.CANT_CHECK': "CAN'T CHECK",
  'severity.high': 'High',
  'severity.medium': 'Medium',
  'severity.low': 'Low',
  'severity.info': 'Info',
  'field.name': 'Name',
  'field.registration': 'Registration',
  'field.phone': 'Phone',
  'field.email': 'Email',
  'field.website': 'Website',
  'field.upi': 'UPI ID',
  'bstatus.same': 'Same',
  'bstatus.same_domain': 'Same domain',
  'bstatus.different': 'Different',
  'bstatus.lookalike': 'Look-alike',
  'bstatus.not_in_record': 'Not on record',
  'bstatus.record_has_none': 'Record lists none',
  'bstatus.not_given': 'Not in message',
};
