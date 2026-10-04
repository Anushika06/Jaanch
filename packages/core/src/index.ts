export * from './schemas/index.js';
export * from './extract/index.js';
export { buildClaims, type ClaimBuildResult } from './claims/build.js';
export * from './text/normalize.js';
export * from './text/names.js';
export * from './text/grounding.js';
export * from './text/domains.js';
export { transliterateDevanagari, hasDevanagari } from './text/transliterate.js';
export * from './rules/table.js';
export * from './verify/ports.js';
export { runVerification, SCHEME_CATEGORY, type VerificationOutput } from './verify/run.js';
export {
  adjudicate,
  reason,
  compareContacts,
  displayName,
  officialNameVariants,
  phoneKey,
  type AdjudicationInput,
  type AdjudicationOutput,
} from './adjudicate/index.js';
export { nextSteps, recoverySteps, OFFICIAL_LINKS, HELPLINES } from './actions/routing.js';
export { EN, DICT_EN, type ReasonCode } from './explain/catalog/en.js';
export { HI, DICT_HI } from './explain/catalog/hi.js';
export {
  t,
  dict,
  formatDate,
  formatNumber,
  sanitizeValue,
  isReasonCode,
  resolveDictRef,
} from './explain/render.js';
export * from './explain/view.js';
export {
  renderWhatsApp,
  renderWhatsAppRecovery,
  WHATSAPP_MAX_CHARS,
  type WhatsAppRenderOptions,
} from './explain/whatsapp.js';
export { renderEvidenceSummary } from './explain/summary.js';
export {
  guardNarrative,
  narrativeFacts,
  templateNarrative,
  type NarrativeFacts,
} from './explain/narrative.js';
export { buildGraph, chooseHeadline, countVerdicts } from './report/assemble.js';
export * from './engine/ports.js';
export {
  InvestigationEngine,
  PIPELINE_VERSION,
  consensusDisagreements,
  redactDigitSequences,
} from './engine/engine.js';
