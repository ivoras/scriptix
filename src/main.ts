import '@fontsource/exo-2/latin-500.css';
import '@fontsource/exo-2/latin-600.css';
import '@fontsource/literata/latin-400.css';
import '@fontsource/literata/latin-400-italic.css';
import '@fontsource/literata/latin-600.css';
import './styles.css';
import { SpeechEngine } from './speech';
import { Store } from './store';
import type { SpeechMode } from './types';
import { AppView } from './view';

const store = new Store();
const engine = new SpeechEngine(store);
const view = new AppView(store);

store.subscribe(() => view.update());
view.update();

let appliedListening = false;
store.subscribe(() => {
  const { session } = store.getState();
  if (session.listening === appliedListening) return;
  appliedListening = session.listening;
  if (session.listening) void engine.start();
  else engine.stop();
});

let spaceHeld = false;
let enterHeld = false;

function typingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return target.isContentEditable;
}

function syncSpeechMode(): void {
  const { session } = store.getState();
  let mode: SpeechMode = 'narration';
  if (session.listening || session.capture) {
    if (enterHeld) mode = 'command';
    else if (spaceHeld) mode = 'dialogue';
  }
  store.setSpeechMode(mode);
  engine.setMode(mode);
}

window.addEventListener(
  'keydown',
  (event) => {
    const { session } = store.getState();
    const typing = typingTarget(event.target);
    if (session.capture) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        view.releaseCapture();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    } else if (typing) {
      return;
    }

    if (event.key === 'Tab') {
      event.preventDefault();
      if (event.repeat) return;
      store.setListening(!session.listening);
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) {
      event.preventDefault();
      store.undo();
      return;
    }

    if (!session.listening && !session.capture) return;
    if (event.key === ' ' && !event.repeat) {
      event.preventDefault();
      spaceHeld = true;
      syncSpeechMode();
    }
    if (event.key === 'Enter' && !event.repeat) {
      event.preventDefault();
      enterHeld = true;
      syncSpeechMode();
    }
  },
  true,
);

window.addEventListener(
  'keyup',
  (event) => {
    const { session } = store.getState();
    if (session.capture) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (event.key === ' ') spaceHeld = false;
    if (event.key === 'Enter') enterHeld = false;
    if (event.key === ' ' || event.key === 'Enter') syncSpeechMode();
  },
  true,
);

window.addEventListener(
  'mousedown',
  (event) => {
    if (!store.getState().session.capture) return;
    event.preventDefault();
    event.stopPropagation();
  },
  true,
);

window.addEventListener(
  'click',
  (event) => {
    if (!store.getState().session.capture) return;
    event.preventDefault();
    event.stopPropagation();
  },
  true,
);

window.addEventListener('contextmenu', (event) => {
  if (store.getState().session.capture) event.preventDefault();
});

document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement != null;
  if (locked) store.setCapture(true);
  else if (store.getState().session.capture) store.setCapture(false);
});

document.addEventListener('pointerlockerror', () => {
  store.setCapture(false);
  store.setCommandMessage('Pointer lock was blocked. Click Capture again and allow the browser to hide the pointer.');
});

void engine.init();
