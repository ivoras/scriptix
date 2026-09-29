import { describe, expect, it } from 'vitest';
import { exportFileNames, renderManuscript, renderReadingPage } from './export-html';
import { parseImport } from './import-text';
import type { Project } from './types';

const project: Project = {
  id: 'p',
  name: 'Night Market',
  createdAt: 1,
  updatedAt: 1,
  chapters: [
    {
      id: 'c',
      title: 'Chapter 1',
      blocks: [
        {
          id: 'b',
          kind: 'prose',
          text: 'Kael waited. She thought *this is enough*.',
          speaker: 'Kael',
          asides: [{ id: 'a', text: 'SECRET-ASIDE-DO-NOT-EXPORT', createdAt: 1 }],
        },
        { id: 's', kind: 'scene' },
        { id: 'b2', kind: 'prose', text: 'The lamps came on.', speaker: '', asides: [] },
      ],
    },
  ],
};

describe('import', () => {
  it('splits blank lines, markdown headings, and html paragraphs', () => {
    expect(parseImport('One line.\n\nTwo lines.', 'text')[0].blocks.map((block) => block.text)).toEqual([
      'One line.',
      'Two lines.',
    ]);
    const markdown = parseImport('# Dawn\n\nFirst.\n\n***\n\n## Dusk\n\nSecond.', 'markdown');
    expect(markdown.map((chapter) => chapter.title)).toEqual(['Dawn', 'Dusk']);
    expect(markdown[0].blocks.map((block) => block.kind)).toEqual(['prose', 'scene']);
    const html = parseImport('<h1>Dawn</h1><p>First.</p><p>* * *</p><h2>Dusk</h2><p>Second.</p>', 'html');
    expect(html.map((chapter) => chapter.title)).toEqual(['Dawn', 'Dusk']);
    expect(html[0].blocks[1].kind).toBe('scene');
  });
});

describe('export', () => {
  it('writes a reading page and a double-spaced manuscript without asides', () => {
    const reading = renderReadingPage(project);
    const manuscript = renderManuscript(project);
    expect(reading).toContain('Night Market');
    expect(reading).toContain('Chapter 1');
    expect(reading).toContain('<em>this is enough</em>');
    expect(reading).not.toContain('SECRET-ASIDE-DO-NOT-EXPORT');
    expect(manuscript).not.toContain('SECRET-ASIDE-DO-NOT-EXPORT');
    expect(manuscript).toContain('line-height: 2');
    expect(manuscript).toContain('<p class="scene">#</p>');
    expect(reading).toContain('<p class="scene">* * *</p>');
    expect(exportFileNames(project)).toEqual({
      reading: 'night-market-reading.html',
      manuscript: 'night-market-manuscript.html',
    });
  });
});
