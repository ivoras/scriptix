import { describe, expect, it } from 'vitest';
import { applyDictionary } from './dictionary';
import {
  appendPiece,
  endsWithJoinPunctuation,
  processUtterance,
  spokenPunctuationApplies,
  wrapDialogue,
} from './prose';

describe('spoken punctuation and marks', () => {
  it('turns narration words into marks and capitalizes the sentence', () => {
    const text = processUtterance('the door opened period', {
      spokenPunctuation: true,
      capitalizeFirst: true,
    });
    expect(text).toBe('The door opened.');
  });

  it('keeps punctuation words inside dialogue when narration-only is set', () => {
    expect(spokenPunctuationApplies('dialogue', 'narration')).toBe(false);
    expect(spokenPunctuationApplies('narration', 'narration')).toBe(true);
    const text = processUtterance('hello period', { spokenPunctuation: false, capitalizeFirst: true });
    expect(text).toBe('Hello period');
  });

  it('writes em dashes, ellipses, and thoughts', () => {
    const text = processUtterance(
      'she felt open thought this is a mistake close thought and left em dash or stayed ellipsis',
      { spokenPunctuation: false, capitalizeFirst: true },
    );
    expect(text).toBe('She felt *this is a mistake* and left—or stayed…');
  });

  it('joins when a pause follows punctuation, including a closed quote', () => {
    expect(endsWithJoinPunctuation('The door opened,')).toBe(true);
    expect(endsWithJoinPunctuation('The door opened')).toBe(false);
    expect(appendPiece('“Hello”', '.')).toBe('“Hello.”');
    expect(endsWithJoinPunctuation(appendPiece('“Hello”', '.'))).toBe(true);
  });

  it('wraps dialogue in American curly doubles and singles inside', () => {
    expect(wrapDialogue('He said "hello" period', 'american')).toBe('“He said ‘hello’ period”');
  });
});

describe('personal dictionary', () => {
  it('replaces whole phrases, with longer phrases winning', () => {
    const text = applyDictionary('mary ann met anne and ann', [
      { id: '1', search: 'ann', replace: 'Ann' },
      { id: '2', search: 'mary ann', replace: 'Mary-Ann' },
    ]);
    expect(text).toBe('Mary-Ann met anne and Ann');
  });
});
