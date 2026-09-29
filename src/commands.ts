export type CommandId =
  | 'new-paragraph'
  | 'new-scene'
  | 'scratch-that'
  | 'undo'
  | 'delete-paragraph'
  | 'stop'
  | 'insert-after'
  | 'replace'
  | 'set-speaker'
  | 'aside';

export interface ParsedCommand {
  id: CommandId;
  rest: string;
}

const COMMANDS: Array<{ phrase: string; id: CommandId; takesRest: boolean }> = [
  { phrase: 'insert after this', id: 'insert-after', takesRest: false },
  { phrase: 'delete paragraph', id: 'delete-paragraph', takesRest: false },
  { phrase: 'new paragraph', id: 'new-paragraph', takesRest: false },
  { phrase: 'scratch that', id: 'scratch-that', takesRest: false },
  { phrase: 'replace this', id: 'replace', takesRest: false },
  { phrase: 'set speaker', id: 'set-speaker', takesRest: true },
  { phrase: 'new scene', id: 'new-scene', takesRest: false },
  { phrase: 'aside', id: 'aside', takesRest: true },
  { phrase: 'undo', id: 'undo', takesRest: false },
  { phrase: 'stop', id: 'stop', takesRest: false },
];

export function normalizeCommandText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[“”‘’"'.,?!;:—–\-…]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseCommand(text: string): ParsedCommand | null {
  const normalized = normalizeCommandText(text);
  if (!normalized) return null;
  const ordered = [...COMMANDS].sort((a, b) => b.phrase.length - a.phrase.length);
  for (const command of ordered) {
    if (normalized === command.phrase) return { id: command.id, rest: '' };
    if (!command.takesRest || !normalized.startsWith(`${command.phrase} `)) continue;
    const rest = text
      .trim()
      .replace(new RegExp(`^${command.phrase}\\b[\\s,.:;—–-]*`, 'i'), '')
      .trim();
    return { id: command.id, rest };
  }
  return null;
}

export function presentSpeakerName(rest: string, original: string): string {
  const source = original.trim() || rest.trim();
  const withoutCommand = source.replace(/^set speaker\s+/i, '').trim();
  const name = withoutCommand || rest.trim();
  if (!name) return '';
  if (name === name.toLowerCase()) {
    return name.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
  }
  return name;
}
