# Scriptix

Scriptix is a static writing desk for novels and stories. Speech becomes prose in the browser. The book stays on your machine.

The speech engine is NVIDIA Parakeet CTC 0.6B (English), running on WebGPU through [Transformers.js](https://huggingface.co/docs/transformers.js). A sentence appears after a short pause. It joins the chapter when that pause follows punctuation. Model files are cached by the browser (the Cache API), not in `localStorage`.

## Run it

Use a current Chrome or Edge on a wide laptop or desktop window. WebGPU has to be available, including 16-bit shader support, which those browsers provide on a normal GPU.

```bash
npm install
npm run dev
```

Open the local URL Vite prints. The first visit downloads the speech model (about 450 MB) and shows that progress in the sentence dock. Projects, chapters, and settings work while the download is still going.

```bash
npm test
npm run build
npm run preview
```

`npm run build` writes the static site to `dist/`. Serve that folder with any static file server. The dev server and `npm run preview` send the cross-origin isolation headers the speech runtime expects.

## Write

- **Tab** turns listening on and off. The Listen button does the same.
- Speech is narration unless you hold a key.
- **Hold Space** for a line of dialogue. Releasing Space closes the quote. Quotes start as American curly doubles, with singles inside.
- **Hold Enter** and speak one command: new paragraph, new scene, scratch that, undo, delete paragraph, stop, insert after this, replace this, set speaker, aside.
- “Scratch that” clears the current sentence before it joins. “Aside” files the next utterance as a note on the paragraph. Aside notes stay out of both export files.
- Spoken “period”, “comma”, and “question mark” become marks in narration and stay words in dialogue, unless you change that in Settings. “Em dash”, “ellipsis”, and “open thought” / “close thought” are always commands.
- Outside capture, click a paragraph and choose continue, insert, or replace. You can also correct a paragraph with the keyboard while listening is off.
- **Capture** hides the pointer and swallows the keyboard the way a game does. Only **Esc** releases it. The sentence line keeps filling the chapter.

The personal dictionary is a list of search-and-replace phrases in Settings. Longer phrases win, and only whole words or phrases match. Replacements run when a sentence joins a paragraph.

## Keep the book

Projects, chapters, paragraphs, aside notes, undo history, session snapshots, and the dictionary are stored in `localStorage` under `scriptix.v1`. A snapshot of the book is taken once each browser session. Restore one from Settings.

**Import** accepts pasted text or a `.txt`, `.html`, or `.md` file, split into paragraphs. Headings in HTML and Markdown start chapters.

**Export** downloads two HTML files: a reading page, and a manuscript page with chapter headings and double spacing.

## License

[Apache License 2.0](LICENSE).
