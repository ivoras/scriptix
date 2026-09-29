import type { DictionaryEntry } from './types';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Longer phrases win. Matches are whole words and phrases only, so a search
 * for "ann" does not change "anne". Replacement text is inserted as written.
 */
export function applyDictionary(text: string, entries: DictionaryEntry[]): string {
  const usable = entries
    .map((entry) => ({ search: entry.search.trim(), replace: entry.replace }))
    .filter((entry) => entry.search.length > 0)
    .sort((a, b) => b.search.length - a.search.length || a.search.localeCompare(b.search));

  if (usable.length === 0 || text.length === 0) return text;

  const tokens: string[] = [];
  let working = text;
  for (const entry of usable) {
    const pattern = new RegExp(
      `(?<![\\p{L}\\p{N}])${escapeRegExp(entry.search)}(?![\\p{L}\\p{N}])`,
      'giu',
    );
    working = working.replace(pattern, () => {
      const token = `\uE010${tokens.length}\uE011`;
      tokens.push(entry.replace);
      return token;
    });
  }
  return working.replace(/\uE010(\d+)\uE011/g, (_match, index: string) => tokens[Number(index)] ?? '');
}
