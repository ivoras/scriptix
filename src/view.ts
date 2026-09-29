import { downloadProjectExport } from './export-html';
import { parseImport, type ImportFormat } from './import-text';
import type { Store } from './store';
import type { Block, ProseBlock, QuoteStyle, SpokenPunctuation } from './types';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function fillInline(node: HTMLElement, text: string): void {
  const parts = text.split('*');
  if (parts.length % 2 === 0) {
    node.textContent = text;
    return;
  }
  parts.forEach((part, index) => {
    if (!part) return;
    if (index % 2 === 1) {
      const emphasis = document.createElement('em');
      emphasis.textContent = part;
      node.append(emphasis);
    } else node.append(document.createTextNode(part));
  });
}

export class AppView {
  private readonly root: HTMLElement;
  private readonly projectList: HTMLElement;
  private readonly chapterList: HTMLElement;
  private readonly prose: HTMLElement;
  private readonly sentence: HTMLElement;
  private readonly modelStatus: HTMLElement;
  private readonly modeStatus: HTMLElement;
  private readonly progress: HTMLElement;
  private readonly crumbProject: HTMLElement;
  private readonly crumbChapter: HTMLElement;
  private readonly saveWarning: HTMLElement;
  private readonly listenButton: HTMLButtonElement;
  private readonly captureButton: HTMLButtonElement;
  private readonly settingsDialog: HTMLDialogElement;
  private readonly importDialog: HTMLDialogElement;
  private readonly dictionaryList: HTMLElement;
  private readonly snapshotList: HTMLElement;
  private proseSignature = '';
  private projectSignature = '';
  private chapterSignature = '';
  private dictionarySignature = '';
  private snapshotSignature = '';
  private renamingProject: string | null = null;
  private renamingChapter: string | null = null;
  private confirmProject: string | null = null;
  private confirmChapter: string | null = null;
  private importFileText = '';
  private importFileName = '';

  constructor(private readonly store: Store) {
    this.root = el('div', 'frame');
    const gate = el('div', 'narrow-gate');
    gate.append(el('p', 'gate-kicker', 'SCRIPTIX'));
    gate.append(el('h1', '', 'A wide window is required'));
    gate.append(
      el(
        'p',
        '',
        'Scriptix is laid out for a desktop or laptop. Widen the window to write.',
      ),
    );

    const header = el('header', 'topbar');
    const brand = el('div', 'brand');
    brand.append(el('span', 'brand-mark', 'SCRIPTIX'));
    brand.append(el('span', 'brand-red'));
    const crumb = el('div', 'crumb');
    this.crumbProject = el('span', 'crumb-project');
    this.crumbChapter = el('span', 'crumb-chapter');
    crumb.append(this.crumbProject, this.crumbChapter);
    const actions = el('div', 'actions');
    this.listenButton = el('button', 'action listen');
    this.listenButton.dataset.testid = 'listen';
    this.listenButton.type = 'button';
    this.captureButton = el('button', 'action capture');
    this.captureButton.dataset.testid = 'capture';
    this.captureButton.type = 'button';
    const exportButton = el('button', 'action', 'Export');
    exportButton.dataset.testid = 'export';
    exportButton.type = 'button';
    const settingsButton = el('button', 'action', 'Settings');
    settingsButton.dataset.testid = 'settings';
    settingsButton.type = 'button';
    actions.append(this.listenButton, this.captureButton, exportButton, settingsButton);
    header.append(brand, crumb, actions);

    const workspace = el('div', 'workspace');
    const center = el('section', 'center');
    const toolbar = el('div', 'prose-toolbar');
    toolbar.append(
      this.commandButton('continue-chapter', 'Continue chapter', () => this.store.continueChapter()),
      this.commandButton('insert-paragraph', 'Insert paragraph', () => this.store.insertAfter()),
      this.commandButton('replace-paragraph', 'Replace paragraph', () => {
        const id = this.selectedProseId();
        if (id) this.store.replaceBlock(id);
      }),
      this.commandButton('delete-paragraph', 'Delete paragraph', () => this.store.deleteBlock()),
      this.commandButton('undo', 'Undo', () => this.store.undo()),
    );
    this.prose = el('div', 'prose-scroll');
    this.prose.dataset.testid = 'prose';
    const dock = el('section', 'sentence-dock');
    this.sentence = el('p', 'sentence');
    this.sentence.dataset.testid = 'sentence';
    const meta = el('div', 'dock-meta');
    this.modelStatus = el('span', 'model-status');
    this.modelStatus.dataset.testid = 'model-status';
    this.modeStatus = el('span', 'mode-status');
    this.modeStatus.dataset.testid = 'mode-status';
    meta.append(
      this.modelStatus,
      this.modeStatus,
      el('span', 'legend', 'Tab listens · Hold Space for dialogue · Hold Enter for a command · Esc releases capture'),
    );
    this.progress = el('div', 'model-progress');
    this.progress.dataset.testid = 'model-progress';
    this.saveWarning = el('p', 'save-warning');
    dock.append(this.sentence, meta, this.progress, this.saveWarning);
    center.append(toolbar, this.prose, dock);

    const side = el('aside', 'side');
    side.dataset.testid = 'side-panel';
    const projects = el('section', 'rail projects');
    projects.dataset.testid = 'projects';
    projects.append(el('h2', 'rail-title', 'Projects'));
    this.projectList = el('div', 'rail-list');
    const projectActions = el('div', 'rail-actions');
    projectActions.append(
      this.commandButton('new-project', 'New project', () => this.store.createProject()),
      this.commandButton('open-import', 'Import', () => this.importDialog.showModal()),
    );
    projects.append(this.projectList, projectActions);

    const chapters = el('section', 'rail chapters');
    chapters.dataset.testid = 'chapters';
    chapters.append(el('h2', 'rail-title', 'Chapters'));
    this.chapterList = el('div', 'rail-list');
    const chapterActions = el('div', 'rail-actions');
    chapterActions.append(this.commandButton('new-chapter', 'New chapter', () => this.store.createChapter()));
    chapters.append(this.chapterList, chapterActions);
    side.append(projects, chapters);
    workspace.append(center, side);
    this.root.append(header, workspace);

    this.settingsDialog = this.buildSettings();
    this.importDialog = this.buildImport();
    this.dictionaryList = this.settingsDialog.querySelector('[data-testid="dictionary"]') as HTMLElement;
    this.snapshotList = this.settingsDialog.querySelector('[data-testid="snapshots"]') as HTMLElement;

    this.listenButton.addEventListener('click', () => {
      const listening = this.store.getState().session.listening;
      this.store.setListening(!listening);
    });
    this.captureButton.addEventListener('click', () => this.requestCapture());
    exportButton.addEventListener('click', () => this.exportProject());
    settingsButton.addEventListener('click', () => {
      this.dictionarySignature = '';
      this.snapshotSignature = '';
      this.syncSettingsForm();
      this.settingsDialog.showModal();
    });

    const app = document.querySelector('#app');
    app?.replaceChildren(gate, this.root, this.settingsDialog, this.importDialog);
  }

  update(): void {
    const { book, session, saveWarning } = this.store.getState();
    document.documentElement.style.setProperty('--chapter-size', `${book.settings.chapterFontSize}pt`);
    document.documentElement.style.setProperty('--sentence-size', `${book.settings.sentenceFontSize}pt`);
    document.body.classList.toggle('is-capturing', session.capture);

    const project = book.projects.find((item) => item.id === book.activeProjectId) ?? null;
    const chapter = project?.chapters.find((item) => item.id === book.activeChapterId) ?? null;
    this.crumbProject.textContent = project?.name ?? 'No project';
    this.crumbChapter.textContent = chapter?.title ?? '';
    this.listenButton.textContent = session.listening ? 'Listening' : 'Listen';
    this.listenButton.classList.toggle('is-on', session.listening);
    this.listenButton.setAttribute('aria-pressed', String(session.listening));
    this.captureButton.textContent = session.capture ? 'Captured' : 'Capture';
    this.captureButton.classList.toggle('is-on', session.capture);
    this.modelStatus.textContent = session.speech.message;
    this.modelStatus.dataset.model = session.speech.model;
    this.progress.style.setProperty('--progress', `${session.speech.progress}%`);
    this.progress.hidden = session.speech.model !== 'downloading' && session.speech.model !== 'loading';
    this.saveWarning.textContent = saveWarning;

    const modeLabel = !session.listening
      ? 'Idle'
      : session.speech.transcribing
        ? 'Transcribing'
        : session.speechMode === 'dialogue'
          ? 'Dialogue'
          : session.speechMode === 'command'
            ? 'Command'
            : 'Narration';
    const expect =
      book.expecting === 'aside'
        ? 'Next utterance files an aside'
        : book.expecting === 'speaker'
          ? 'Next utterance names the speaker'
          : '';
    this.modeStatus.textContent = [modeLabel, session.commandMessage, expect].filter(Boolean).join(' · ');

    const pending = book.pendingSentence.trim();
    this.sentence.classList.toggle('is-placeholder', pending.length === 0);
    this.sentence.textContent = pending || 'The current sentence appears here after a pause.';

    this.renderProjects();
    this.renderChapters();
    this.renderProse();
    if (this.settingsDialog.open) {
      this.renderDictionary();
      this.renderSnapshots();
    }
  }

  requestCapture(): void {
    if (this.store.getState().session.capture) return;
    this.settingsDialog.close();
    this.importDialog.close();
    const root = document.documentElement as HTMLElement & { requestPointerLock?: () => Promise<void> | void };
    try {
      const result = root.requestPointerLock();
      if (result && typeof (result as Promise<void>).catch === 'function') {
        void (result as Promise<void>).catch(() => {
          this.store.setCommandMessage('Pointer lock was blocked. Click Capture again.');
        });
      }
    } catch {
      this.store.setCommandMessage('Pointer lock was blocked. Click Capture again.');
    }
  }

  releaseCapture(): void {
    if (document.pointerLockElement) document.exitPointerLock();
    this.store.setCapture(false);
  }

  private exportProject(): void {
    const { book } = this.store.getState();
    const project = book.projects.find((item) => item.id === book.activeProjectId);
    if (!project) return;
    downloadProjectExport(project);
  }

  private selectedProseId(): string | null {
    const { book } = this.store.getState();
    const id = book.selectedBlockId ?? book.targetBlockId;
    if (!id) return null;
    const project = book.projects.find((item) => item.id === book.activeProjectId);
    const chapter = project?.chapters.find((item) => item.id === book.activeChapterId);
    const block = chapter?.blocks.find((item) => item.id === id);
    return block?.kind === 'prose' ? block.id : null;
  }

  private commandButton(testId: string, label: string, onClick: () => void): HTMLButtonElement {
    const button = el('button', 'text-button', label);
    button.type = 'button';
    button.dataset.testid = testId;
    button.addEventListener('click', onClick);
    return button;
  }

  private renderProjects(): void {
    const { book } = this.store.getState();
    const signature = JSON.stringify({
      projects: book.projects.map((project) => ({
        id: project.id,
        name: project.name,
        chapters: project.chapters.length,
      })),
      active: book.activeProjectId,
      renaming: this.renamingProject,
      confirm: this.confirmProject,
    });
    if (signature === this.projectSignature) return;
    this.projectSignature = signature;
    this.projectList.replaceChildren();
    for (const project of book.projects) {
      const row = el('div', 'row');
      row.classList.toggle('is-active', project.id === book.activeProjectId);
      if (this.renamingProject === project.id) {
        const input = el('input', 'rename');
        input.value = project.name;
        input.setAttribute('aria-label', 'Project name');
        input.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') input.blur();
          if (event.key === 'Escape') {
            this.renamingProject = null;
            this.projectSignature = '';
            this.renderProjects();
          }
        });
        input.addEventListener('blur', () => {
          const value = input.value;
          this.renamingProject = null;
          window.setTimeout(() => {
            this.projectSignature = '';
            this.store.renameProject(project.id, value);
            this.renderProjects();
          }, 0);
        });
        row.append(input);
        this.projectList.append(row);
        input.focus();
        continue;
      }
      const select = el('button', 'row-name', project.name);
      select.type = 'button';
      select.addEventListener('click', () => this.store.selectProject(project.id));
      const meta = el('span', 'row-meta', `${project.chapters.length}`);
      const rename = el('button', 'icon-button', 'Rename');
      rename.type = 'button';
      rename.addEventListener('click', () => {
        this.renamingProject = project.id;
        this.projectSignature = '';
        this.renderProjects();
      });
      const remove = el('button', 'icon-button danger', this.confirmProject === project.id ? 'Confirm' : 'Delete');
      remove.type = 'button';
      remove.addEventListener('click', () => {
        if (this.confirmProject !== project.id) {
          this.confirmProject = project.id;
          this.projectSignature = '';
          this.renderProjects();
          return;
        }
        this.confirmProject = null;
        this.store.deleteProject(project.id);
      });
      row.append(select, meta, rename, remove);
      this.projectList.append(row);
    }
  }

  private renderChapters(): void {
    const { book } = this.store.getState();
    const project = book.projects.find((item) => item.id === book.activeProjectId);
    const signature = JSON.stringify({
      chapters: project?.chapters.map((chapter) => ({ id: chapter.id, title: chapter.title, n: chapter.blocks.length })) ?? [],
      active: book.activeChapterId,
      renaming: this.renamingChapter,
      confirm: this.confirmChapter,
    });
    if (signature === this.chapterSignature) return;
    this.chapterSignature = signature;
    this.chapterList.replaceChildren();
    if (!project) {
      this.chapterList.append(el('p', 'empty', 'Create a project first.'));
      return;
    }
    if (project.chapters.length === 0) {
      this.chapterList.append(el('p', 'empty', 'No chapters yet.'));
      return;
    }
    project.chapters.forEach((chapter, index) => {
      const row = el('div', 'row');
      row.classList.toggle('is-active', chapter.id === book.activeChapterId);
      if (this.renamingChapter === chapter.id) {
        const input = el('input', 'rename');
        input.value = chapter.title;
        input.setAttribute('aria-label', 'Chapter title');
        input.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') input.blur();
          if (event.key === 'Escape') {
            this.renamingChapter = null;
            this.chapterSignature = '';
            this.renderChapters();
          }
        });
        input.addEventListener('blur', () => {
          const value = input.value;
          this.renamingChapter = null;
          window.setTimeout(() => {
            this.chapterSignature = '';
            this.store.renameChapter(chapter.id, value);
            this.renderChapters();
          }, 0);
        });
        row.append(input);
        this.chapterList.append(row);
        input.focus();
        return;
      }
      const select = el('button', 'row-name', chapter.title);
      select.type = 'button';
      select.addEventListener('click', () => this.store.selectChapter(chapter.id));
      const rename = el('button', 'icon-button', 'Rename');
      rename.type = 'button';
      rename.addEventListener('click', () => {
        this.renamingChapter = chapter.id;
        this.chapterSignature = '';
        this.renderChapters();
      });
      const up = el('button', 'icon-button', 'Up');
      up.type = 'button';
      up.disabled = index === 0;
      up.addEventListener('click', () => this.store.moveChapter(chapter.id, -1));
      const down = el('button', 'icon-button', 'Down');
      down.type = 'button';
      down.disabled = index === project.chapters.length - 1;
      down.addEventListener('click', () => this.store.moveChapter(chapter.id, 1));
      const remove = el('button', 'icon-button danger', this.confirmChapter === chapter.id ? 'Confirm' : 'Delete');
      remove.type = 'button';
      remove.addEventListener('click', () => {
        if (this.confirmChapter !== chapter.id) {
          this.confirmChapter = chapter.id;
          this.chapterSignature = '';
          this.renderChapters();
          return;
        }
        this.confirmChapter = null;
        this.store.deleteChapter(chapter.id);
      });
      row.append(select, rename, up, down, remove);
      this.chapterList.append(row);
    });
  }

  private renderProse(): void {
    const { book, session } = this.store.getState();
    if (this.prose.contains(document.activeElement) && document.activeElement instanceof HTMLElement && document.activeElement.isContentEditable) {
      return;
    }
    const project = book.projects.find((item) => item.id === book.activeProjectId);
    const chapter = project?.chapters.find((item) => item.id === book.activeChapterId);
    const signature = JSON.stringify({
      chapter,
      target: book.targetBlockId,
      selected: book.selectedBlockId,
      mode: book.targetMode,
      armed: book.replaceArmed,
      listening: session.listening,
      capture: session.capture,
    });
    if (signature === this.proseSignature) return;
    this.proseSignature = signature;
    this.prose.replaceChildren();
    if (!chapter) {
      this.prose.append(el('p', 'empty prose-empty', 'Create a chapter to start the page.'));
      return;
    }
    const sheet = el('div', 'sheet');
    const title = el('h2', 'chapter-title', chapter.title);
    sheet.append(title);
    if (chapter.blocks.length === 0) {
      sheet.append(el('p', 'empty', 'This chapter has no paragraphs yet.'));
    }
    for (const block of chapter.blocks) sheet.append(this.renderBlock(block, book, session.listening || session.capture));
    this.prose.append(sheet);
  }

  private renderBlock(block: Block, book: ReturnType<Store['getState']>['book'], lockText: boolean): HTMLElement {
    if (block.kind === 'scene') {
      const scene = el('button', 'scene-break', '* * *');
      scene.type = 'button';
      scene.classList.toggle('is-selected', block.id === book.selectedBlockId);
      scene.addEventListener('click', () => this.store.selectBlock(block.id));
      return scene;
    }
    return this.renderProseBlock(block, book, lockText);
  }

  private renderProseBlock(block: ProseBlock, book: ReturnType<Store['getState']>['book'], lockText: boolean): HTMLElement {
    const article = el('article', 'paragraph-block');
    article.classList.toggle('is-selected', block.id === book.selectedBlockId);
    article.classList.toggle('is-target', block.id === book.targetBlockId);
    if (block.id === book.targetBlockId) {
      const label = book.targetMode === 'replace' && book.replaceArmed ? 'Replacing' : 'Continuing';
      article.append(el('span', 'aim', label));
    }
    if (block.speaker) {
      const speaker = el('p', 'speaker');
      speaker.append(el('span', '', block.speaker));
      const clear = el('button', 'icon-button', 'Clear speaker');
      clear.type = 'button';
      clear.addEventListener('click', (event) => {
        event.stopPropagation();
        this.store.clearSpeaker(block.id);
      });
      speaker.append(clear);
      article.append(speaker);
    }
    const body = el('div', 'paragraph');
    body.dataset.blockId = block.id;
    if (!lockText) {
      body.contentEditable = 'true';
      body.spellcheck = true;
      body.setAttribute('role', 'textbox');
      body.setAttribute('aria-label', 'Paragraph');
    }
    fillInline(body, block.text);
    if (!block.text) body.dataset.empty = 'true';
    body.addEventListener('focus', () => {
      this.store.selectBlock(block.id);
      body.textContent = block.text;
    });
    body.addEventListener('blur', () => {
      this.proseSignature = '';
      this.store.updateParagraphText(block.id, body.textContent ?? '');
    });
    body.addEventListener('click', () => this.store.selectBlock(block.id));
    article.append(body);
    if (block.asides.length) {
      const notes = el('ul', 'asides');
      for (const aside of block.asides) {
        const item = el('li', 'aside');
        item.append(el('span', 'aside-label', 'Aside'));
        item.append(el('span', 'aside-text', aside.text));
        const remove = el('button', 'icon-button', 'Remove aside');
        remove.type = 'button';
        remove.addEventListener('click', () => this.store.removeAside(block.id, aside.id));
        item.append(remove);
        notes.append(item);
      }
      article.append(notes);
    }
    return article;
  }

  private buildSettings(): HTMLDialogElement {
    const dialog = el('dialog', 'panel-dialog');
    dialog.dataset.testid = 'settings-dialog';
    dialog.append(el('h2', '', 'Settings'));
    const form = el('div', 'settings-grid');

    form.append(this.field('Quote style', this.selectSetting('quote-style', [
      ['american', 'American curly doubles'],
      ['british', 'British curly singles'],
      ['straight', 'Straight quotes'],
    ], (value) => this.store.updateSettings({ quoteStyle: value as QuoteStyle }))));

    form.append(this.field('Spoken punctuation', this.selectSetting('spoken-punctuation', [
      ['narration', 'Narration only'],
      ['always', 'Narration and dialogue'],
      ['never', 'Never'],
    ], (value) => this.store.updateSettings({ spokenPunctuation: value as SpokenPunctuation }))));

    form.append(this.field('Chapter text', this.rangeSetting('chapter-font', 14, 28, (value) => {
      this.store.updateSettings({ chapterFontSize: value });
    })));
    form.append(this.field('Current sentence', this.rangeSetting('sentence-font', 30, 72, (value) => {
      this.store.updateSettings({ sentenceFontSize: value });
    })));

    const dictionary = el('section', 'dictionary');
    dictionary.append(el('h3', '', 'Personal dictionary'));
    dictionary.append(el('p', 'hint', 'Longer phrases win. Matches are whole words and phrases, applied when a sentence joins a paragraph.'));
    const list = el('div', 'dictionary-list');
    list.dataset.testid = 'dictionary';
    dictionary.append(list);
    dictionary.append(this.commandButton('add-dictionary', 'Add phrase', () => this.store.addDictionaryEntry()));
    form.append(dictionary);

    const snapshots = el('section', 'snapshots');
    snapshots.append(el('h3', '', 'Session snapshots'));
    const snapshotList = el('div', 'snapshot-list');
    snapshotList.dataset.testid = 'snapshots';
    snapshots.append(snapshotList);
    form.append(snapshots);

    const close = el('button', 'text-button close-dialog', 'Close');
    close.type = 'button';
    close.addEventListener('click', () => dialog.close());
    dialog.append(form, close);
    return dialog;
  }

  private field(label: string, control: HTMLElement): HTMLElement {
    const wrap = el('label', 'field');
    wrap.append(el('span', 'field-label', label));
    wrap.append(control);
    return wrap;
  }

  private selectSetting(testId: string, options: Array<[string, string]>, onChange: (value: string) => void): HTMLSelectElement {
    const select = el('select');
    select.dataset.testid = testId;
    for (const [value, label] of options) {
      const option = el('option', '', label);
      option.value = value;
      select.append(option);
    }
    select.addEventListener('change', () => onChange(select.value));
    return select;
  }

  private rangeSetting(testId: string, min: number, max: number, onChange: (value: number) => void): HTMLElement {
    const wrap = el('span', 'range-wrap');
    const input = el('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.dataset.testid = testId;
    const readout = el('span', 'range-readout', '');
    input.addEventListener('input', () => {
      readout.textContent = `${input.value} pt`;
      onChange(Number(input.value));
    });
    wrap.append(input, readout);
    return wrap;
  }

  private syncSettingsForm(): void {
    const { book } = this.store.getState();
    const quote = this.settingsDialog.querySelector<HTMLSelectElement>('[data-testid="quote-style"]');
    const punctuation = this.settingsDialog.querySelector<HTMLSelectElement>('[data-testid="spoken-punctuation"]');
    const chapter = this.settingsDialog.querySelector<HTMLInputElement>('[data-testid="chapter-font"]');
    const sentence = this.settingsDialog.querySelector<HTMLInputElement>('[data-testid="sentence-font"]');
    if (quote) quote.value = book.settings.quoteStyle;
    if (punctuation) punctuation.value = book.settings.spokenPunctuation;
    if (chapter) {
      chapter.value = String(book.settings.chapterFontSize);
      const readout = chapter.parentElement?.querySelector('.range-readout');
      if (readout) readout.textContent = `${chapter.value} pt`;
    }
    if (sentence) {
      sentence.value = String(book.settings.sentenceFontSize);
      const readout = sentence.parentElement?.querySelector('.range-readout');
      if (readout) readout.textContent = `${sentence.value} pt`;
    }
    this.renderDictionary();
    this.renderSnapshots();
  }

  private renderDictionary(): void {
    const entries = this.store.getState().book.settings.dictionary;
    const signature = entries.map((entry) => entry.id).join('|');
    if (signature === this.dictionarySignature) return;
    if (this.dictionaryList.contains(document.activeElement)) return;
    this.dictionarySignature = signature;
    this.dictionaryList.replaceChildren();
    if (entries.length === 0) {
      this.dictionaryList.append(el('p', 'empty', 'No replacements yet.'));
      return;
    }
    for (const entry of entries) {
      const row = el('div', 'dictionary-row');
      const search = el('input');
      search.value = entry.search;
      search.placeholder = 'Heard as';
      search.setAttribute('aria-label', 'Heard as');
      search.addEventListener('input', () => this.store.updateDictionaryEntry(entry.id, { search: search.value }));
      const replace = el('input');
      replace.value = entry.replace;
      replace.placeholder = 'Write as';
      replace.setAttribute('aria-label', 'Write as');
      replace.addEventListener('input', () => this.store.updateDictionaryEntry(entry.id, { replace: replace.value }));
      const remove = el('button', 'icon-button danger', 'Remove');
      remove.type = 'button';
      remove.addEventListener('click', () => this.store.removeDictionaryEntry(entry.id));
      row.append(search, replace, remove);
      this.dictionaryList.append(row);
    }
  }

  private renderSnapshots(): void {
    const snapshots = this.store.getState().book.snapshots;
    const signature = snapshots.map((snapshot) => snapshot.id).join('|');
    if (signature === this.snapshotSignature) return;
    this.snapshotSignature = signature;
    this.snapshotList.replaceChildren();
    if (snapshots.length === 0) {
      this.snapshotList.append(el('p', 'empty', 'No snapshots yet.'));
      return;
    }
    for (const snapshot of [...snapshots].reverse()) {
      const row = el('div', 'snapshot-row');
      const when = new Date(snapshot.takenAt);
      row.append(el('span', '', `Session ${when.toLocaleString()}`));
      const restore = el('button', 'icon-button', 'Restore');
      restore.type = 'button';
      restore.addEventListener('click', () => {
        this.store.restoreSnapshot(snapshot.id);
        this.proseSignature = '';
        this.projectSignature = '';
        this.chapterSignature = '';
      });
      row.append(restore);
      this.snapshotList.append(row);
    }
  }

  private buildImport(): HTMLDialogElement {
    const dialog = el('dialog', 'panel-dialog');
    dialog.dataset.testid = 'import-dialog';
    dialog.append(el('h2', '', 'Import'));
    dialog.append(el('p', 'hint', 'Paste text or choose a text, HTML, or Markdown file. Blank lines become paragraphs. Headings in HTML and Markdown start chapters.'));
    const paste = el('textarea');
    paste.dataset.testid = 'import-paste';
    paste.rows = 8;
    paste.placeholder = 'Paste a chapter or a whole draft…';
    const file = el('input');
    file.type = 'file';
    file.accept = '.txt,.html,.htm,.md,.markdown,text/plain,text/html,text/markdown';
    file.dataset.testid = 'import-file';
    file.addEventListener('change', () => {
      const chosen = file.files?.[0];
      if (!chosen) return;
      void chosen.text().then((text) => {
        this.importFileText = text;
        this.importFileName = chosen.name;
      });
    });
    const format = el('select');
    format.dataset.testid = 'import-format';
    for (const [value, label] of [
      ['auto', 'Detect format'],
      ['text', 'Plain text'],
      ['html', 'HTML'],
      ['markdown', 'Markdown'],
    ] as Array<[ImportFormat, string]>) {
      const option = el('option', '', label);
      option.value = value;
      format.append(option);
    }
    const mode = el('select');
    mode.dataset.testid = 'import-mode';
    for (const [value, label] of [
      ['new-chapters', 'New chapters'],
      ['append', 'Append to current chapter'],
    ]) {
      const option = el('option', '', label);
      option.value = value;
      mode.append(option);
    }
    const actions = el('div', 'dialog-actions');
    const confirm = el('button', 'text-button', 'Import');
    confirm.type = 'button';
    confirm.dataset.testid = 'import-confirm';
    confirm.addEventListener('click', () => {
      const source = this.importFileText.trim() ? this.importFileText : paste.value;
      const chapters = parseImport(source, format.value as ImportFormat, this.importFileName);
      if (chapters.length === 0) {
        this.store.setCommandMessage('Nothing to import.');
        return;
      }
      this.store.importChapters(chapters, mode.value as 'append' | 'new-chapters');
      paste.value = '';
      this.importFileText = '';
      this.importFileName = '';
      file.value = '';
      this.proseSignature = '';
      dialog.close();
    });
    const cancel = el('button', 'text-button', 'Cancel');
    cancel.type = 'button';
    cancel.addEventListener('click', () => dialog.close());
    actions.append(confirm, cancel);
    dialog.append(paste, file, this.field('Format', format), this.field('Destination', mode), actions);
    return dialog;
  }
}
