import type { Verdict } from '@jaanch/core';

const CLASS: Record<Verdict, string> = {
  CONTRADICTED: 'stamp--contradicted',
  MATCHES: 'stamp--matches',
  NOT_FOUND: 'stamp--notfound',
  CANT_CHECK: 'stamp--cantcheck',
};

/** A per-claim verdict mark, styled after an office rubber stamp. Never used for a whole report. */
export function Stamp({
  verdict,
  label,
  size = 'md',
}: {
  verdict: Verdict;
  label: string;
  size?: 'sm' | 'md';
}) {
  return (
    <span className={`stamp ${CLASS[verdict]} stamp--${size}`} role="img" aria-label={label}>
      <span className="stamp__ink">{label}</span>
    </span>
  );
}
