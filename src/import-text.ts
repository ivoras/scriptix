export interface ImportedBlock {
  kind: 'prose' | 'scene';
  text: string;
}

export interface ImportedChapter {
  title: string;
  blocks: ImportedBlock[];
}

const SCENE_LINE = /^(?:\* *\* *\*|\*\*\*|---|#)$/;

function tidy(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function isScene(text: string): boolean {
  return SCENE_LINE.test(text.trim());
}

export function parsePlainText(input: string): ImportedChapter[] {
  const blocks: ImportedBlock[] = [];
  for (const chunk of input.replace(/\r\n/g, '\n').split(/\n\s*\n/)) {
    const text = tidy(chunk.replace(/\n/g, ' '));
    if (!text) continue;
    blocks.push(isScene(text) ? { kind: 'scene', text: '' } : { kind: 'prose', text });
  }
  return blocks.length ? [{ title: '', blocks }] : [];
}

export function parseMarkdown(input: string): ImportedChapter[] {
  const chapters: ImportedChapter[] = [];
  let current: ImportedChapter = { title: '', blocks: [] };
  let buffer: string[] = [];

  const flush = () => {
    const text = tidy(buffer.join(' '));
    buffer = [];
    if (!text) return;
    current.blocks.push(isScene(text) ? { kind: 'scene', text: '' } : { kind: 'prose', text });
  };

  const pushCurrent = () => {
    if (current.title || current.blocks.length) chapters.push(current);
  };

  for (const line of input.replace(/\r\n/g, '\n').split('\n')) {
    const heading = /^(#{1,2})\s+(.+?)\s*#*$/.exec(line.trim());
    if (heading) {
      flush();
      pushCurrent();
      current = { title: heading[2].trim(), blocks: [] };
      continue;
    }
    if (/^#{3,}\s+/.test(line.trim())) {
      flush();
      const text = line.trim().replace(/^#{3,}\s+/, '').trim();
      if (text) current.blocks.push({ kind: 'prose', text });
      continue;
    }
    if (line.trim() === '') flush();
    else buffer.push(line.trim());
  }
  flush();
  pushCurrent();
  return chapters;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function stripTags(text: string): string {
  return decodeEntities(text.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' '));
}

export function parseHtml(input: string): ImportedChapter[] {
  const withoutNoise = input
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');
  if (!/<(p|h1|h2|h3|li|blockquote|hr|br)\b/i.test(withoutNoise)) {
    return parsePlainText(stripTags(withoutNoise));
  }

  const chapters: ImportedChapter[] = [];
  let current: ImportedChapter = { title: '', blocks: [] };
  const pattern = /<(h1|h2|h3|p|li|blockquote|hr)\b[^>]*>([\s\S]*?)<\/\1>|<hr\s*\/?>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(withoutNoise))) {
    const tag = (match[1] ?? 'hr').toLowerCase();
    if (tag === 'hr') {
      if (current.title || current.blocks.length || chapters.length === 0) {
        current.blocks.push({ kind: 'scene', text: '' });
      }
      continue;
    }
    const text = tidy(stripTags(match[2] ?? ''));
    if (!text && tag !== 'hr') continue;
    if (tag === 'h1' || tag === 'h2') {
      if (current.title || current.blocks.length) chapters.push(current);
      current = { title: text, blocks: [] };
      continue;
    }
    current.blocks.push(isScene(text) ? { kind: 'scene', text: '' } : { kind: 'prose', text });
  }
  if (current.title || current.blocks.length) chapters.push(current);
  return chapters;
}

export type ImportFormat = 'text' | 'html' | 'markdown' | 'auto';

export function detectFormat(input: string, fileName = ''): 'text' | 'html' | 'markdown' {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'markdown';
  if (lower.endsWith('.txt')) return 'text';
  const sample = input.trim().slice(0, 400);
  if (/^<!doctype html/i.test(sample) || /<html[\s>]/i.test(sample) || /<(p|h1|h2)\b/i.test(sample)) return 'html';
  if (/^#{1,2}\s+\S/m.test(input)) return 'markdown';
  return 'text';
}

export function parseImport(input: string, format: ImportFormat, fileName = ''): ImportedChapter[] {
  const resolved = format === 'auto' ? detectFormat(input, fileName) : format;
  if (resolved === 'html') return parseHtml(input);
  if (resolved === 'markdown') return parseMarkdown(input);
  return parsePlainText(input);
}
