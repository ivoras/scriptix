import type { Project } from './types';
import { escapeHtml, renderInlineHtml } from './prose';

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || 'project';
}

function chapterBody(project: Project, manuscript: boolean): string {
  return project.chapters
    .map((chapter) => {
      const heading = `<h2>${escapeHtml(chapter.title || 'Untitled chapter')}</h2>`;
      const blocks = chapter.blocks
        .map((block) => {
          if (block.kind === 'scene') {
            return manuscript ? '<p class="scene">#</p>' : '<p class="scene">* * *</p>';
          }
          if (!block.text.trim()) return '';
          const speaker = block.speaker.trim()
            ? `<p class="speaker">${escapeHtml(block.speaker.trim())}</p>`
            : '';
          return `${speaker}<p>${renderInlineHtml(block.text)}</p>`;
        })
        .join('\n');
      return `${heading}\n${blocks}`;
    })
    .join('\n');
}

export function renderReadingPage(project: Project): string {
  const title = escapeHtml(project.name || 'Untitled project');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <style>
    body { margin: 3rem auto; max-width: 40rem; padding: 0 1.5rem; background: #fbf8f3; color: #1c1915; font-family: Georgia, "Iowan Old Style", Palatino, "Palatino Linotype", serif; font-size: 18px; line-height: 1.65; }
    h1 { font-weight: 600; font-size: 2rem; margin: 0 0 2rem; }
    h2 { font-weight: 600; font-size: 1.4rem; margin: 2.4rem 0 1rem; }
    p { margin: 0 0 1rem; }
    .scene { text-align: center; letter-spacing: 0.35em; margin: 1.6rem 0; }
    .speaker { font-variant: small-caps; letter-spacing: 0.08em; font-size: 0.85rem; color: #5c5346; margin: 0 0 0.2rem; }
    em { font-style: italic; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  ${chapterBody(project, false)}
</body>
</html>
`;
}

export function renderManuscript(project: Project): string {
  const title = escapeHtml(project.name || 'Untitled project');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${title} — manuscript</title>
  <style>
    body { margin: 1in; background: #fff; color: #000; font-family: "Courier New", Courier, monospace; font-size: 12pt; line-height: 2; }
    h1, h2 { text-align: center; font-weight: normal; line-height: 2; margin: 0; }
    h1 { margin-bottom: 1em; }
    h2 { margin-top: 1em; }
    p { margin: 0; text-indent: 0.5in; }
    .scene, .speaker, h1, h2 { text-indent: 0; }
    .scene { text-align: center; }
    .speaker { font-weight: bold; }
    em { font-style: italic; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  ${chapterBody(project, true)}
</body>
</html>
`;
}

export function exportFileNames(project: Project): { reading: string; manuscript: string } {
  const slug = slugify(project.name);
  return { reading: `${slug}-reading.html`, manuscript: `${slug}-manuscript.html` };
}

export function downloadHtml(filename: string, html: string): void {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function downloadProjectExport(project: Project): void {
  const names = exportFileNames(project);
  downloadHtml(names.reading, renderReadingPage(project));
  window.setTimeout(() => downloadHtml(names.manuscript, renderManuscript(project)), 400);
}
