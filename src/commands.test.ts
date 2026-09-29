import { describe, expect, it } from 'vitest';
import { parseCommand, presentSpeakerName } from './commands';

describe('voice commands', () => {
  it('matches the command list and keeps a speaker name', () => {
    expect(parseCommand('scratch that.')?.id).toBe('scratch-that');
    expect(parseCommand('insert after this')?.id).toBe('insert-after');
    expect(parseCommand('new paragraph please')).toBeNull();
    expect(parseCommand('set speaker Jane Doe')).toEqual({ id: 'set-speaker', rest: 'Jane Doe' });
    expect(parseCommand('aside remember the well')?.id).toBe('aside');
  });

  it('title-cases an all-lowercase speaker', () => {
    expect(presentSpeakerName('jane doe', 'jane doe')).toBe('Jane Doe');
  });
});
