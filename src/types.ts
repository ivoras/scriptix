export type QuoteStyle = 'american' | 'british' | 'straight';
export type SpokenPunctuation = 'narration' | 'always' | 'never';
export type TargetMode = 'continue' | 'replace';
export type SpeechMode = 'narration' | 'dialogue' | 'command';
export type Expecting = 'aside' | 'speaker' | null;

export interface DictionaryEntry {
  id: string;
  search: string;
  replace: string;
}

export interface Settings {
  quoteStyle: QuoteStyle;
  spokenPunctuation: SpokenPunctuation;
  dictionary: DictionaryEntry[];
  chapterFontSize: number;
  sentenceFontSize: number;
}

export interface Aside {
  id: string;
  text: string;
  createdAt: number;
}

export interface ProseBlock {
  id: string;
  kind: 'prose';
  text: string;
  speaker: string;
  asides: Aside[];
}

export interface SceneBlock {
  id: string;
  kind: 'scene';
}

export type Block = ProseBlock | SceneBlock;

export interface Chapter {
  id: string;
  title: string;
  blocks: Block[];
}

export interface Project {
  id: string;
  name: string;
  chapters: Chapter[];
  createdAt: number;
  updatedAt: number;
}

export interface Snapshot {
  id: string;
  takenAt: number;
  projects: Project[];
}

export interface HistorySnap {
  projects: Project[];
  activeProjectId: string | null;
  activeChapterId: string | null;
  selectedBlockId: string | null;
  targetBlockId: string | null;
  targetMode: TargetMode;
  replaceArmed: boolean;
  pendingSentence: string;
  expecting: Expecting;
}

export interface Persisted {
  version: 1;
  projects: Project[];
  activeProjectId: string | null;
  activeChapterId: string | null;
  selectedBlockId: string | null;
  targetBlockId: string | null;
  targetMode: TargetMode;
  replaceArmed: boolean;
  pendingSentence: string;
  expecting: Expecting;
  settings: Settings;
  undo: HistorySnap[];
  snapshots: Snapshot[];
}

export type ModelPhase = 'checking' | 'downloading' | 'loading' | 'ready' | 'unavailable' | 'error';

export interface SpeechStatus {
  model: ModelPhase;
  progress: number;
  message: string;
  transcribing: boolean;
}

export interface SessionState {
  listening: boolean;
  capture: boolean;
  speechMode: SpeechMode;
  speech: SpeechStatus;
  commandMessage: string;
}

export const STORAGE_KEY = 'scriptix.v1';
export const SESSION_SNAPSHOT_KEY = 'scriptix.session-snapshot';
export const UNDO_LIMIT = 40;
export const SNAPSHOT_LIMIT = 8;
export const DEFAULT_CHAPTER_FONT = 18;
export const DEFAULT_SENTENCE_FONT = 32;
