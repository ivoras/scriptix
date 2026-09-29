import type { QuoteStyle, SpokenPunctuation, SpeechMode } from './types';

export interface QuoteMarks {
  open: string;
  close: string;
  innerOpen: string;
  innerClose: string;
}

export const QUOTE_MARKS: Record<QuoteStyle, QuoteMarks> = {
  american: { open: '“', close: '”', innerOpen: '‘', innerClose: '’' },
  british: { open: '‘', close: '’', innerOpen: '“', innerClose: '”' },
  straight: { open: '"', close: '"', innerOpen: "'", innerClose: "'" },
};

const OPEN_THOUGHT = '\uE000';
const CLOSE_THOUGHT = '\uE001';

const SPOKEN_FORMS: Array<{ phrase: string; value: string; punctuation: boolean }> = [
  { phrase: 'question mark', value: '?', punctuation: true },
  { phrase: 'open thought', value: OPEN_THOUGHT, punctuation: false },
  { phrase: 'close thought', value: CLOSE_THOUGHT, punctuation: false },
  { phrase: 'em dash', value: '—', punctuation: false },
  { phrase: 'ellipsis', value: '…', punctuation: false },
  { phrase: 'period', value: '.', punctuation: true },
  { phrase: 'comma', value: ',', punctuation: true },
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function spokenPunctuationApplies(mode: SpeechMode, setting: SpokenPunctuation): boolean {
  if (mode === 'command') return false;
  if (setting === 'always') return true;
  if (setting === 'never') return false;
  return mode === 'narration';
}

export function processUtterance(
  raw: string,
  options: { spokenPunctuation: boolean; capitalizeFirst: boolean },
): string {
  let text = raw.replace(/\s+/g, ' ').trim();
  if (!text) return '';

  const forms = [...SPOKEN_FORMS].sort((a, b) => b.phrase.length - a.phrase.length);
  for (const form of forms) {
    if (form.punctuation && !options.spokenPunctuation) continue;
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(form.phrase)}(?![\\p{L}\\p{N}])`, 'giu');
    text = text.replace(pattern, ` ${form.value} `);
  }

  text = text
    .replace(/\s+([.,?])/g, '$1')
    .replace(/\s+…/g, '…')
    .replace(/\s*—\s*/g, '—')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

  text = text
    .replace(new RegExp(`\\s*${OPEN_THOUGHT}\\s*`, 'g'), ' *')
    .replace(new RegExp(`\\s*${CLOSE_THOUGHT}\\s*`, 'g'), '* ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+\*/g, ' *')
    .replace(/\*\s+/g, '* ')
    .trim();

  text = capitalize(text, options.capitalizeFirst);
  return text.trim();
}

function capitalize(text: string, capitalizeFirst: boolean): string {
  let result = text;
  if (capitalizeFirst) {
    result = result.replace(/[A-Za-z]/, (letter) => letter.toUpperCase());
  }
  result = result.replace(/([.?!…])(\s+)([a-z])/g, (_match, mark: string, space: string, letter: string) => {
    return mark + space + letter.toUpperCase();
  });
  return result;
}

export function shouldCapitalizeNext(context: string): boolean {
  const trimmed = context.trim();
  if (!trimmed) return true;
  const stripped = trimmed.replace(/[”"’']+$/u, '').trimEnd();
  return /[.?!…]$/u.test(stripped);
}

export function appendPiece(pending: string, piece: string): string {
  const base = pending.trim();
  const next = piece.trim();
  if (!base) return next;
  if (!next) return base;
  if (/^[.,?!…]$/u.test(next) && /[”"’']$/u.test(base)) {
    return `${base.slice(0, -1)}${next}${base.slice(-1)}`;
  }
  return `${base} ${next}`.replace(/\s+([.,?!…])/g, '$1').replace(/[ \t]{2,}/g, ' ').trim();
}

export function endsWithJoinPunctuation(text: string): boolean {
  const stripped = text.trim().replace(/[”"’']+$/u, '').trimEnd();
  return /[.,?!…—]$/u.test(stripped);
}

export function wrapDialogue(text: string, style: QuoteStyle): string {
  const marks = QUOTE_MARKS[style];
  const trimmed = text.trim();
  if (!trimmed) return '';
  let innerOpenNext = true;
  const inner = trimmed.replace(/[“”"]/g, () => {
    const quote = innerOpenNext ? marks.innerOpen : marks.innerClose;
    innerOpenNext = !innerOpenNext;
    return quote;
  });
  return `${marks.open}${inner}${marks.close}`;
}

export function renderInlineHtml(text: string): string {
  const parts = text.split('*');
  if (parts.length % 2 === 0) return escapeHtml(text);
  return parts
    .map((part, index) => (index % 2 === 1 ? `<em>${escapeHtml(part)}</em>` : escapeHtml(part)))
    .join('');
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
