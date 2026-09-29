import { describe, expect, it } from 'vitest';
import { Store, type KeyValueStorage } from './store';
import { STORAGE_KEY } from './types';

class MemoryStorage implements KeyValueStorage {
  private readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

function createStore(): { store: Store; storage: MemoryStorage } {
  const storage = new MemoryStorage();
  const sessions = new MemoryStorage();
  const store = new Store({ storage, sessionStorage: sessions, now: () => 1_700_000_000_000 });
  return { store, storage };
}

describe('book storage', () => {
  it('persists projects, chapters, paragraphs, dictionary entries, and a session snapshot', () => {
    const { store, storage } = createStore();
    store.renameProject(store.getState().book.activeProjectId ?? '', 'Harbor');
    store.renameChapter(store.getState().book.activeChapterId ?? '', 'Arrival');
    store.takeUtterance('the door opened period', 'narration');
    store.addDictionaryEntry();
    const entry = store.getState().book.settings.dictionary[0];
    store.updateDictionaryEntry(entry.id, { search: 'kale', replace: 'Kael' });
    const saved = JSON.parse(storage.getItem(STORAGE_KEY) ?? '{}') as { projects: Array<{ name: string }> };
    expect(saved.projects[0].name).toBe('Harbor');
    expect(store.getState().book.snapshots).toHaveLength(1);

    const reloaded = new Store({
      storage,
      sessionStorage: new MemoryStorage(),
      now: () => 1_700_000_100_000,
    });
    expect(reloaded.getState().book.projects[0].name).toBe('Harbor');
    expect(reloaded.getState().book.projects[0].chapters[0].title).toBe('Arrival');
    const paragraph = reloaded.getState().book.projects[0].chapters[0].blocks[0];
    expect(paragraph.kind).toBe('prose');
    if (paragraph.kind === 'prose') expect(paragraph.text).toBe('The door opened.');
  });

  it('joins punctuated narration, keeps an unfinished sentence, and applies the dictionary on join', () => {
    const { store } = createStore();
    store.addDictionaryEntry();
    const entry = store.getState().book.settings.dictionary[0];
    store.updateDictionaryEntry(entry.id, { search: 'kale', replace: 'Kael' });
    store.takeUtterance('kale waited', 'narration');
    expect(store.getState().book.pendingSentence).toBe('Kale waited');
    const paragraph = store.getState().book.projects[0].chapters[0].blocks[0];
    expect(paragraph.kind === 'prose' && paragraph.text).toBe('');
    store.takeUtterance('period', 'narration');
    const joined = store.getState().book.projects[0].chapters[0].blocks[0];
    expect(joined.kind === 'prose' && joined.text).toBe('Kael waited.');
    expect(store.getState().book.pendingSentence).toBe('');
  });

  it('closes dialogue quotes, files asides, and undoes the aside', () => {
    const { store } = createStore();
    store.takeUtterance('not tonight', 'dialogue');
    expect(store.getState().book.pendingSentence).toBe('“Not tonight”');
    store.takeUtterance('period', 'narration');
    const block = store.getState().book.projects[0].chapters[0].blocks[0];
    expect(block.kind === 'prose' && block.text).toBe('“Not tonight.”');
    store.takeUtterance('aside', 'command');
    store.takeUtterance('the well is east', 'narration');
    const noted = store.getState().book.projects[0].chapters[0].blocks[0];
    expect(noted.kind === 'prose' && noted.asides[0].text).toBe('The well is east');
    store.undo();
    const undone = store.getState().book.projects[0].chapters[0].blocks[0];
    expect(undone.kind === 'prose' && undone.asides).toHaveLength(0);
  });

  it('scratches the current sentence and inserts a paragraph between others', () => {
    const { store } = createStore();
    store.takeUtterance('keep this period', 'narration');
    store.takeUtterance('not yet', 'narration');
    store.takeUtterance('scratch that', 'command');
    expect(store.getState().book.pendingSentence).toBe('');
    const first = store.getState().book.projects[0].chapters[0].blocks[0];
    store.insertAfter(first.id);
    const blocks = store.getState().book.projects[0].chapters[0].blocks;
    expect(blocks).toHaveLength(2);
    expect(blocks[1].kind).toBe('prose');
    store.takeUtterance('between them period', 'narration');
    const inserted = store.getState().book.projects[0].chapters[0].blocks[1];
    expect(inserted.kind === 'prose' && inserted.text).toBe('Between them.');
  });

  it('imports text into chapters', () => {
    const { store } = createStore();
    store.importChapters(
      [
        { title: 'Dawn', blocks: [{ kind: 'prose', text: 'Morning.' }] },
        { title: 'Dusk', blocks: [{ kind: 'prose', text: 'Evening.' }] },
      ],
      'new-chapters',
    );
    const titles = store.getState().book.projects[0].chapters.map((chapter) => chapter.title);
    expect(titles).toContain('Dawn');
    expect(titles).toContain('Dusk');
  });
});
