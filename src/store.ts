import { parseCommand, presentSpeakerName, type CommandId } from './commands';
import { applyDictionary } from './dictionary';
import type { ImportedChapter } from './import-text';
import { createId } from './id';
import {
  appendPiece,
  endsWithJoinPunctuation,
  processUtterance,
  shouldCapitalizeNext,
  spokenPunctuationApplies,
  wrapDialogue,
} from './prose';
import {
  DEFAULT_CHAPTER_FONT,
  DEFAULT_SENTENCE_FONT,
  SESSION_SNAPSHOT_KEY,
  SNAPSHOT_LIMIT,
  STORAGE_KEY,
  UNDO_LIMIT,
  type Aside,
  type Block,
  type Chapter,
  type HistorySnap,
  type Persisted,
  type Project,
  type ProseBlock,
  type SessionState,
  type Settings,
  type Snapshot,
  type SpeechMode,
  type SpeechStatus,
  type TargetMode,
} from './types';

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface StoreOptions {
  storage?: KeyValueStorage;
  sessionStorage?: KeyValueStorage;
  now?: () => number;
}

const defaultSpeech = (): SpeechStatus => ({
  model: 'checking',
  progress: 0,
  message: 'Checking WebGPU…',
  transcribing: false,
});

function defaultSettings(): Settings {
  return {
    quoteStyle: 'american',
    spokenPunctuation: 'narration',
    dictionary: [],
    chapterFontSize: DEFAULT_CHAPTER_FONT,
    sentenceFontSize: DEFAULT_SENTENCE_FONT,
  };
}

function emptyPersisted(): Persisted {
  return {
    version: 1,
    projects: [],
    activeProjectId: null,
    activeChapterId: null,
    selectedBlockId: null,
    targetBlockId: null,
    targetMode: 'continue',
    replaceArmed: false,
    pendingSentence: '',
    expecting: null,
    settings: defaultSettings(),
    undo: [],
    snapshots: [],
  };
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export class Store {
  private data: Persisted;
  private session: SessionState;
  private readonly storage: KeyValueStorage;
  private readonly sessions: KeyValueStorage;
  private readonly now: () => number;
  private readonly listeners = new Set<() => void>();
  private saveWarning = '';

  constructor(options: StoreOptions = {}) {
    this.storage = options.storage ?? localStorage;
    this.sessions = options.sessionStorage ?? sessionStorage;
    this.now = options.now ?? Date.now;
    this.data = this.load();
    if (this.data.projects.length === 0) this.seedBook();
    this.ensureSelection();
    this.session = {
      listening: false,
      capture: false,
      speechMode: 'narration',
      speech: defaultSpeech(),
      commandMessage: '',
    };
    this.takeSessionSnapshot();
    this.persist();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState(): { book: Persisted; session: SessionState; saveWarning: string } {
    return { book: this.data, session: this.session, saveWarning: this.saveWarning };
  }

  setListening(listening: boolean): void {
    this.session.listening = listening;
    if (!listening) this.session.commandMessage = this.session.commandMessage;
    this.emit();
  }

  setCapture(capture: boolean): void {
    this.session.capture = capture;
    this.emit();
  }

  setSpeechMode(speechMode: SpeechMode): void {
    if (this.session.speechMode === speechMode) return;
    this.session.speechMode = speechMode;
    this.emit();
  }

  setSpeech(patch: Partial<SpeechStatus>): void {
    this.session.speech = { ...this.session.speech, ...patch };
    this.emit();
  }

  setCommandMessage(message: string): void {
    this.session.commandMessage = message;
    this.emit();
  }

  updateSettings(patch: Partial<Omit<Settings, 'dictionary'>>): void {
    if (patch.chapterFontSize !== undefined) {
      patch = { ...patch, chapterFontSize: clamp(patch.chapterFontSize, 14, 28) };
    }
    if (patch.sentenceFontSize !== undefined) {
      patch = { ...patch, sentenceFontSize: clamp(patch.sentenceFontSize, 30, 72) };
    }
    this.data.settings = { ...this.data.settings, ...patch };
    this.persist();
    this.emit();
  }

  addDictionaryEntry(): void {
    this.data.settings.dictionary = [
      ...this.data.settings.dictionary,
      { id: createId(), search: '', replace: '' },
    ];
    this.persist();
    this.emit();
  }

  updateDictionaryEntry(id: string, patch: { search?: string; replace?: string }): void {
    this.data.settings.dictionary = this.data.settings.dictionary.map((entry) =>
      entry.id === id ? { ...entry, ...patch } : entry,
    );
    this.persist();
    this.emit();
  }

  removeDictionaryEntry(id: string): void {
    this.data.settings.dictionary = this.data.settings.dictionary.filter((entry) => entry.id !== id);
    this.persist();
    this.emit();
  }

  createProject(name = 'Untitled project'): void {
    this.mutate(() => {
      const project = this.makeProject(name);
      this.data.projects.push(project);
      this.data.activeProjectId = project.id;
      this.data.activeChapterId = project.chapters[0]?.id ?? null;
      this.selectInitialBlock();
    });
  }

  renameProject(id: string, name: string): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    this.mutate(() => {
      const project = this.data.projects.find((item) => item.id === id);
      if (project) project.name = trimmed;
    });
  }

  deleteProject(id: string): void {
    this.mutate(() => {
      this.data.projects = this.data.projects.filter((project) => project.id !== id);
      if (this.data.activeProjectId === id) {
        this.data.activeProjectId = this.data.projects[0]?.id ?? null;
        this.data.activeChapterId = this.activeProject()?.chapters[0]?.id ?? null;
        this.selectInitialBlock();
      }
    });
  }

  selectProject(id: string): void {
    if (!this.data.projects.some((project) => project.id === id)) return;
    this.data.activeProjectId = id;
    this.data.activeChapterId = this.activeProject()?.chapters[0]?.id ?? null;
    this.selectInitialBlock();
    this.persist();
    this.emit();
  }

  createChapter(title?: string): void {
    const project = this.activeProject();
    if (!project) return;
    this.mutate(() => {
      const chapter = this.makeChapter(title ?? `Chapter ${project.chapters.length + 1}`);
      project.chapters.push(chapter);
      this.data.activeChapterId = chapter.id;
      this.selectInitialBlock();
    });
  }

  renameChapter(id: string, title: string): void {
    const trimmed = title.trim();
    if (!trimmed) return;
    this.mutate(() => {
      const chapter = this.findChapter(id);
      if (chapter) chapter.title = trimmed;
    });
  }

  deleteChapter(id: string): void {
    const project = this.activeProject();
    if (!project) return;
    this.mutate(() => {
      project.chapters = project.chapters.filter((chapter) => chapter.id !== id);
      if (this.data.activeChapterId === id) {
        this.data.activeChapterId = project.chapters[0]?.id ?? null;
        this.selectInitialBlock();
      }
    });
  }

  selectChapter(id: string): void {
    if (!this.findChapter(id)) return;
    this.data.activeChapterId = id;
    this.selectInitialBlock();
    this.persist();
    this.emit();
  }

  moveChapter(id: string, direction: -1 | 1): void {
    const project = this.activeProject();
    if (!project) return;
    const index = project.chapters.findIndex((chapter) => chapter.id === id);
    const next = index + direction;
    if (index < 0 || next < 0 || next >= project.chapters.length) return;
    this.mutate(() => {
      const [chapter] = project.chapters.splice(index, 1);
      project.chapters.splice(next, 0, chapter);
    });
  }

  selectBlock(id: string | null): void {
    this.data.selectedBlockId = id;
    this.persist();
    this.emit();
  }

  continueChapter(): void {
    const chapter = this.activeChapter();
    if (!chapter) return;
    this.mutate(() => {
      let prose = [...chapter.blocks].reverse().find((block) => block.kind === 'prose') as ProseBlock | undefined;
      if (!prose) {
        prose = this.makeProse();
        chapter.blocks.push(prose);
      }
      this.aim(prose.id, 'continue');
    });
  }

  continueBlock(id: string): void {
    const found = this.findBlock(id);
    if (!found || found.block.kind !== 'prose') return;
    this.mutate(() => this.aim(id, 'continue'));
  }

  insertAfter(id?: string | null): void {
    const chapter = this.activeChapter();
    if (!chapter) return;
    this.mutate(() => {
      this.insertProseAfter(id ?? this.data.selectedBlockId ?? this.data.targetBlockId);
    });
  }

  replaceBlock(id: string): void {
    const found = this.findBlock(id);
    if (!found || found.block.kind !== 'prose') return;
    this.mutate(() => this.aim(id, 'replace'));
  }

  deleteBlock(id?: string | null): void {
    const blockId = id ?? this.data.selectedBlockId ?? this.data.targetBlockId;
    if (!blockId) return;
    const found = this.findBlock(blockId);
    if (!found) return;
    this.mutate(() => {
      found.chapter.blocks.splice(found.index, 1);
      if (this.data.pendingSentence && this.data.targetBlockId === blockId) this.data.pendingSentence = '';
      const neighbor = found.chapter.blocks[found.index] ?? found.chapter.blocks[found.index - 1] ?? null;
      this.data.selectedBlockId = neighbor?.id ?? null;
      if (this.data.targetBlockId === blockId) {
        if (neighbor && neighbor.kind === 'prose') this.aim(neighbor.id, 'continue');
        else {
          this.data.targetBlockId = neighbor?.id ?? null;
          this.data.targetMode = 'continue';
          this.data.replaceArmed = false;
        }
      }
    });
  }

  updateParagraphText(id: string, text: string): void {
    const found = this.findBlock(id);
    if (!found || found.block.kind !== 'prose') return;
    if (found.block.text === text) return;
    this.mutate(() => {
      (found.block as ProseBlock).text = text;
    });
  }

  removeAside(blockId: string, asideId: string): void {
    const found = this.findBlock(blockId);
    if (!found || found.block.kind !== 'prose') return;
    const block = found.block;
    this.mutate(() => {
      block.asides = block.asides.filter((aside) => aside.id !== asideId);
    });
  }

  clearSpeaker(blockId: string): void {
    const found = this.findBlock(blockId);
    if (!found || found.block.kind !== 'prose') return;
    const block = found.block;
    this.mutate(() => {
      block.speaker = '';
    });
  }

  undo(): void {
    const snap = this.data.undo.pop();
    if (!snap) {
      this.session.commandMessage = 'Nothing to undo.';
      this.emit();
      return;
    }
    this.data.projects = snap.projects;
    this.data.activeProjectId = snap.activeProjectId;
    this.data.activeChapterId = snap.activeChapterId;
    this.data.selectedBlockId = snap.selectedBlockId;
    this.data.targetBlockId = snap.targetBlockId;
    this.data.targetMode = snap.targetMode;
    this.data.replaceArmed = snap.replaceArmed;
    this.data.pendingSentence = snap.pendingSentence;
    this.data.expecting = snap.expecting;
    this.session.commandMessage = 'Undid the last change.';
    this.persist();
    this.emit();
  }

  restoreSnapshot(id: string): void {
    const snapshot = this.data.snapshots.find((item) => item.id === id);
    if (!snapshot) return;
    this.mutate(() => {
      this.data.projects = structuredClone(snapshot.projects);
      this.ensureSelection();
    });
    this.session.commandMessage = 'Restored a session snapshot.';
    this.emit();
  }

  importChapters(chapters: ImportedChapter[], mode: 'append' | 'new-chapters'): void {
    const usable = chapters
      .map((chapter) => ({
        title: chapter.title.trim(),
        blocks: chapter.blocks.filter((block) => block.kind === 'scene' || block.text.trim()),
      }))
      .filter((chapter) => chapter.title || chapter.blocks.length);
    if (usable.length === 0) return;
    this.mutate(() => {
      let project = this.activeProject();
      if (!project) {
        project = this.makeProject('Imported project');
        this.data.projects.push(project);
        this.data.activeProjectId = project.id;
      }
      if (mode === 'append') {
        let chapter = this.activeChapter();
        if (!chapter) {
          chapter = this.makeChapter(usable[0].title || 'Imported chapter');
          project.chapters.push(chapter);
          this.data.activeChapterId = chapter.id;
        } else if (!chapter.blocks.length && usable[0].title) {
          chapter.title = usable[0].title;
        }
        for (const imported of usable) {
          for (const block of imported.blocks) chapter.blocks.push(this.blockFromImport(block));
        }
        this.aimAtLastProse(chapter);
        return;
      }
      let firstId: string | null = null;
      for (const imported of usable) {
        const chapter = this.makeChapter(imported.title || `Chapter ${project.chapters.length + 1}`);
        chapter.blocks = imported.blocks.map((block) => this.blockFromImport(block));
        project.chapters.push(chapter);
        firstId ??= chapter.id;
      }
      if (firstId) {
        this.data.activeChapterId = firstId;
        const chapter = this.findChapter(firstId);
        if (chapter) this.aimAtLastProse(chapter);
      }
    });
  }

  takeUtterance(raw: string, mode: SpeechMode): void {
    const text = raw.replace(/\s+/g, ' ').trim();
    if (!text) return;
    if (mode === 'command') {
      this.executeCommand(text);
      return;
    }
    if (this.data.expecting === 'aside') {
      this.fileAside(this.shapeUtterance(text, mode));
      return;
    }
    if (this.data.expecting === 'speaker') {
      this.fileSpeaker(text);
      return;
    }
    const pieceSource = this.shapeUtterance(text, mode);
    if (!pieceSource) return;
    const piece = mode === 'dialogue' ? wrapDialogue(pieceSource, this.data.settings.quoteStyle) : pieceSource;
    if (!piece) return;
    const combined = appendPiece(this.data.pendingSentence, piece);
    if (endsWithJoinPunctuation(combined)) {
      this.mutate(() => {
        this.data.pendingSentence = combined;
        this.commitPending(false);
      });
      return;
    }
    this.data.pendingSentence = combined;
    this.persist();
    this.emit();
  }

  private executeCommand(text: string): void {
    const command = parseCommand(text);
    if (!command) {
      this.session.commandMessage = `Unrecognized command: ${text}`;
      this.emit();
      return;
    }
    const rest = command.rest;
    switch (command.id as CommandId) {
      case 'scratch-that':
        this.data.pendingSentence = '';
        this.session.commandMessage = 'Cleared the current sentence.';
        this.persist();
        this.emit();
        break;
      case 'undo':
        this.undo();
        break;
      case 'stop':
        this.session.listening = false;
        this.session.commandMessage = 'Listening stopped.';
        this.emit();
        break;
      case 'new-paragraph':
        this.mutate(() => {
          this.commitPending(true);
          this.insertProseAfter(this.data.targetBlockId);
        });
        this.setCommandMessage('New paragraph.');
        break;
      case 'new-scene':
        this.mutate(() => {
          this.commitPending(true);
          const chapter = this.activeChapter();
          if (!chapter) return;
          const anchor = this.data.targetBlockId;
          const index = anchor ? chapter.blocks.findIndex((block) => block.id === anchor) : chapter.blocks.length - 1;
          const scene: Block = { id: createId(), kind: 'scene' };
          const prose = this.makeProse();
          const at = index < 0 ? chapter.blocks.length : index + 1;
          chapter.blocks.splice(at, 0, scene, prose);
          this.aim(prose.id, 'continue');
        });
        this.setCommandMessage('New scene.');
        break;
      case 'delete-paragraph':
        this.deleteBlock(this.data.targetBlockId);
        this.session.commandMessage = 'Deleted the paragraph.';
        this.emit();
        break;
      case 'insert-after':
        this.insertAfter(this.data.targetBlockId ?? this.data.selectedBlockId);
        this.session.commandMessage = 'Inserted a paragraph.';
        this.emit();
        break;
      case 'replace': {
        const id = this.data.targetBlockId ?? this.data.selectedBlockId;
        if (id) this.replaceBlock(id);
        this.session.commandMessage = 'The next sentence will replace this paragraph.';
        this.emit();
        break;
      }
      case 'set-speaker':
        if (rest) this.fileSpeaker(rest);
        else {
          this.data.expecting = 'speaker';
          this.session.commandMessage = 'The next utterance names the speaker.';
          this.persist();
          this.emit();
        }
        break;
      case 'aside':
        if (rest) this.fileAside(this.shapeUtterance(rest, 'narration'));
        else {
          this.data.expecting = 'aside';
          this.session.commandMessage = 'The next utterance will be filed as an aside.';
          this.persist();
          this.emit();
        }
        break;
      default:
        break;
    }
  }

  private fileAside(text: string): void {
    const note = text.trim();
    if (!note) {
      this.data.expecting = null;
      this.persist();
      this.setCommandMessage('Aside was empty.');
      return;
    }
    this.mutate(() => {
      this.data.expecting = null;
      const prose = this.ensureTargetProse();
      if (!prose) return;
      const aside: Aside = { id: createId(), text: note, createdAt: this.now() };
      prose.asides.push(aside);
    });
    this.setCommandMessage('Filed an aside.');
  }

  private fileSpeaker(text: string): void {
    const name = presentSpeakerName(text, text);
    if (!name) {
      this.data.expecting = null;
      this.persist();
      this.setCommandMessage('Speaker name was empty.');
      return;
    }
    this.mutate(() => {
      this.data.expecting = null;
      const prose = this.ensureTargetProse();
      if (!prose) return;
      prose.speaker = name;
    });
    this.setCommandMessage(`Speaker set to ${name}.`);
  }

  private shapeUtterance(raw: string, mode: SpeechMode): string {
    const context = `${this.targetText()} ${this.data.pendingSentence}`;
    return processUtterance(raw, {
      spokenPunctuation: spokenPunctuationApplies(mode, this.data.settings.spokenPunctuation),
      capitalizeFirst: shouldCapitalizeNext(context),
    });
  }

  private commitPending(force: boolean): void {
    const sentence = this.data.pendingSentence.trim();
    if (!sentence) return;
    if (!force && !endsWithJoinPunctuation(sentence)) return;
    const prose = this.ensureTargetProse();
    if (!prose) return;
    const next = applyDictionary(sentence, this.data.settings.dictionary);
    if (this.data.targetMode === 'replace' && this.data.replaceArmed) {
      prose.text = next;
      this.data.replaceArmed = false;
      this.data.targetMode = 'continue';
    } else if (!prose.text.trim()) prose.text = next;
    else prose.text = `${prose.text.trimEnd()} ${next}`.replace(/\s+([.,?!…])/g, '$1');
    this.data.pendingSentence = '';
  }

  private targetText(): string {
    const found = this.data.targetBlockId ? this.findBlock(this.data.targetBlockId) : null;
    if (!found || found.block.kind !== 'prose') return '';
    return found.block.text;
  }

  private ensureTargetProse(): ProseBlock | null {
    const chapter = this.activeChapter();
    if (!chapter) return null;
    const found = this.data.targetBlockId ? this.findBlock(this.data.targetBlockId) : null;
    if (found && found.block.kind === 'prose') return found.block;
    const prose = this.makeProse();
    chapter.blocks.push(prose);
    this.aim(prose.id, 'continue');
    return prose;
  }

  private aim(id: string, mode: TargetMode): void {
    this.data.selectedBlockId = id;
    this.data.targetBlockId = id;
    this.data.targetMode = mode;
    this.data.replaceArmed = mode === 'replace';
  }

  private aimAtLastProse(chapter: Chapter): void {
    const prose = [...chapter.blocks].reverse().find((block) => block.kind === 'prose') as ProseBlock | undefined;
    if (prose) this.aim(prose.id, 'continue');
    else this.data.selectedBlockId = chapter.blocks[0]?.id ?? null;
  }

  private blockFromImport(block: { kind: 'prose' | 'scene'; text: string }): Block {
    if (block.kind === 'scene') return { id: createId(), kind: 'scene' };
    return { ...this.makeProse(), text: block.text };
  }

  private insertProseAfter(anchorId: string | null): void {
    const chapter = this.activeChapter();
    if (!chapter) return;
    const index = anchorId ? chapter.blocks.findIndex((block) => block.id === anchorId) : chapter.blocks.length - 1;
    const prose = this.makeProse();
    const at = index < 0 ? chapter.blocks.length : index + 1;
    chapter.blocks.splice(at, 0, prose);
    this.aim(prose.id, 'continue');
  }

  private mutate(fn: () => void): void {
    this.pushUndo();
    fn();
    const project = this.activeProject();
    if (project) project.updatedAt = this.now();
    this.persist();
    this.emit();
  }

  private pushUndo(): void {
    const snap: HistorySnap = {
      projects: structuredClone(this.data.projects),
      activeProjectId: this.data.activeProjectId,
      activeChapterId: this.data.activeChapterId,
      selectedBlockId: this.data.selectedBlockId,
      targetBlockId: this.data.targetBlockId,
      targetMode: this.data.targetMode,
      replaceArmed: this.data.replaceArmed,
      pendingSentence: this.data.pendingSentence,
      expecting: this.data.expecting,
    };
    this.data.undo.push(snap);
    if (this.data.undo.length > UNDO_LIMIT) this.data.undo.splice(0, this.data.undo.length - UNDO_LIMIT);
  }

  private seedBook(): void {
    const project = this.makeProject('Untitled project');
    this.data.projects = [project];
    this.data.activeProjectId = project.id;
    this.data.activeChapterId = project.chapters[0].id;
    this.selectInitialBlock();
  }

  private makeProject(name: string): Project {
    const now = this.now();
    return {
      id: createId(),
      name,
      chapters: [this.makeChapter('Chapter 1')],
      createdAt: now,
      updatedAt: now,
    };
  }

  private makeChapter(title: string): Chapter {
    const prose = this.makeProse();
    return { id: createId(), title, blocks: [prose] };
  }

  private makeProse(): ProseBlock {
    return { id: createId(), kind: 'prose', text: '', speaker: '', asides: [] };
  }

  private selectInitialBlock(): void {
    const chapter = this.activeChapter();
    const prose = chapter?.blocks.find((block) => block.kind === 'prose') as ProseBlock | undefined;
    this.data.selectedBlockId = prose?.id ?? chapter?.blocks[0]?.id ?? null;
    this.data.targetBlockId = prose?.id ?? null;
    this.data.targetMode = 'continue';
    this.data.replaceArmed = false;
    this.data.pendingSentence = '';
    this.data.expecting = null;
  }

  private ensureSelection(): void {
    if (!this.activeProject() && this.data.projects[0]) this.data.activeProjectId = this.data.projects[0].id;
    if (!this.activeChapter()) this.data.activeChapterId = this.activeProject()?.chapters[0]?.id ?? null;
    if (this.data.targetBlockId && !this.findBlock(this.data.targetBlockId)) this.selectInitialBlock();
  }

  private activeProject(): Project | null {
    return this.data.projects.find((project) => project.id === this.data.activeProjectId) ?? null;
  }

  private activeChapter(): Chapter | null {
    return this.findChapter(this.data.activeChapterId ?? '');
  }

  private findChapter(id: string): Chapter | null {
    const project = this.activeProject();
    return project?.chapters.find((chapter) => chapter.id === id) ?? null;
  }

  private findBlock(id: string): { chapter: Chapter; block: ProseBlock | Extract<Block, { kind: 'scene' }>; index: number } | null {
    const project = this.activeProject();
    if (!project) return null;
    for (const chapter of project.chapters) {
      const index = chapter.blocks.findIndex((block) => block.id === id);
      if (index >= 0) return { chapter, block: chapter.blocks[index], index };
    }
    return null;
  }

  private takeSessionSnapshot(): void {
    let already = false;
    try {
      already = this.sessions.getItem(SESSION_SNAPSHOT_KEY) === '1';
    } catch {
      already = false;
    }
    if (already) return;
    const snapshot: Snapshot = {
      id: createId(),
      takenAt: this.now(),
      projects: structuredClone(this.data.projects),
    };
    this.data.snapshots.push(snapshot);
    if (this.data.snapshots.length > SNAPSHOT_LIMIT) {
      this.data.snapshots.splice(0, this.data.snapshots.length - SNAPSHOT_LIMIT);
    }
    try {
      this.sessions.setItem(SESSION_SNAPSHOT_KEY, '1');
    } catch {
      /* session storage can be unavailable; the snapshot is still kept */
    }
  }

  private load(): Persisted {
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return emptyPersisted();
      const parsed = JSON.parse(raw) as Partial<Persisted>;
      if (parsed.version !== 1 || !Array.isArray(parsed.projects)) return emptyPersisted();
      return {
        ...emptyPersisted(),
        ...parsed,
        settings: { ...defaultSettings(), ...(parsed.settings ?? {}) },
        undo: Array.isArray(parsed.undo) ? parsed.undo : [],
        snapshots: Array.isArray(parsed.snapshots) ? parsed.snapshots : [],
      };
    } catch {
      return emptyPersisted();
    }
  }

  private persist(): void {
    const write = () => this.storage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    try {
      write();
      this.saveWarning = '';
    } catch {
      this.data.snapshots.splice(0, Math.ceil(this.data.snapshots.length / 2));
      this.data.undo.splice(0, Math.ceil(this.data.undo.length / 2));
      try {
        write();
        this.saveWarning = 'Storage was nearly full, so older undo steps and snapshots were removed.';
      } catch {
        this.saveWarning = 'Could not save. Browser storage is full.';
      }
    }
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
