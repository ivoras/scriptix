import type { SpeechMode } from './types';
import type { Store } from './store';

const TARGET_RATE = 16000;
const FRAME_SAMPLES = 320;
const FRAME_MS = 20;
const SILENCE_MS = 600;
const MIN_SPEECH_MS = 280;
const MAX_UTTERANCE_MS = 20000;
const MAX_QUEUE_MS = 60000;
const TAIL_MS = 120;

interface QueuedUtterance {
  audio: Float32Array;
  mode: SpeechMode;
}

interface WorkerProgress {
  type: 'progress';
  progress: number;
  loaded: number;
  total: number;
}

interface WorkerResult {
  type: 'result';
  id: number;
  text: string;
  error?: string;
}

type WorkerMessage =
  | WorkerProgress
  | WorkerResult
  | { type: 'ready' }
  | { type: 'error'; message: string }
  | { type: 'status'; message: string }
  | { type: 'file-progress'; file: string; progress: number };

function rms(samples: Float32Array): number {
  let sum = 0;
  for (let index = 0; index < samples.length; index += 1) sum += samples[index] * samples[index];
  return Math.sqrt(sum / samples.length);
}

function concat(parts: Float32Array[]): Float32Array {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const merged = new Float32Array(length);
  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.length;
  }
  return merged;
}

function resampleLinear(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate || input.length === 0) return input;
  const length = Math.max(1, Math.floor((input.length * toRate) / fromRate));
  const output = new Float32Array(length);
  const ratio = fromRate / toRate;
  for (let index = 0; index < length; index += 1) {
    const position = index * ratio;
    const left = Math.floor(position);
    const fraction = position - left;
    const a = input[left] ?? 0;
    const b = input[Math.min(left + 1, input.length - 1)] ?? a;
    output[index] = a + (b - a) * fraction;
  }
  return output;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
}

/**
 * Live microphone capture with pause detection. Utterances are transcribed by
 * the Parakeet CTC model on WebGPU. Nothing here invents a transcript.
 */
export class SpeechEngine {
  private worker: Worker | null = null;
  private mode: SpeechMode = 'narration';
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private remainder = new Float32Array(0);
  private frames: Float32Array[] = [];
  private speechMs = 0;
  private silenceMs = 0;
  private voiced = false;
  private noise = 0.008;
  private micOn = false;
  private modelReady = false;
  private busy = false;
  private queue: QueuedUtterance[] = [];
  private queueMs = 0;
  private nextId = 1;
  private pendingModes = new Map<number, SpeechMode>();
  private tailTimer = 0;

  constructor(private readonly store: Store) {}

  async init(): Promise<void> {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
    if (!gpu) {
      this.store.setSpeech({
        model: 'unavailable',
        message: 'WebGPU is not available in this browser. Writing tools still work.',
      });
      return;
    }
    const adapter = await gpu.requestAdapter();
    if (!adapter) {
      this.store.setSpeech({
        model: 'unavailable',
        message: 'No WebGPU adapter was found. Writing tools still work.',
      });
      return;
    }
    this.worker = new Worker(new URL('./speech-worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<WorkerMessage>) => this.onWorker(event.data);
    this.worker.onerror = (event) => {
      this.store.setSpeech({
        model: 'error',
        message: event.message || 'The speech worker failed to start.',
      });
    };
    this.store.setSpeech({ model: 'downloading', progress: 0, message: 'Downloading speech model…' });
    const basePath = new URL(import.meta.env.BASE_URL, window.location.href).pathname;
    this.worker.postMessage({ type: 'load', basePath });
  }

  setMode(next: SpeechMode): void {
    if (next === this.mode && this.tailTimer === 0) return;
    const closing = this.mode;
    if (this.tailTimer) {
      window.clearTimeout(this.tailTimer);
      this.tailTimer = 0;
    }
    const releasing = closing !== 'narration' && next === 'narration';
    if (releasing) {
      this.tailTimer = window.setTimeout(() => {
        this.tailTimer = 0;
        this.flush(closing, true);
        this.mode = next;
      }, TAIL_MS);
      return;
    }
    this.flush(closing, true);
    this.mode = next;
  }

  async start(): Promise<void> {
    if (this.micOn) return;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      this.context = new AudioContext();
      await this.context.resume();
      const source = this.context.createMediaStreamSource(this.stream);
      this.processor = this.context.createScriptProcessor(4096, 1, 1);
      const mute = this.context.createGain();
      mute.gain.value = 0;
      this.processor.onaudioprocess = (event) => {
        if (!this.micOn) return;
        const channel = event.inputBuffer.getChannelData(0);
        this.consume(new Float32Array(channel), event.inputBuffer.sampleRate);
      };
      source.connect(this.processor);
      this.processor.connect(mute);
      mute.connect(this.context.destination);
      this.micOn = true;
    } catch (error) {
      this.store.setListening(false);
      const message = error instanceof Error ? error.message : 'Microphone permission was denied.';
      this.store.setCommandMessage(message);
    }
  }

  stop(): void {
    if (this.tailTimer) {
      window.clearTimeout(this.tailTimer);
      this.tailTimer = 0;
    }
    this.flush(this.mode, true);
    this.micOn = false;
    this.processor?.disconnect();
    this.processor = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    void this.context?.close();
    this.context = null;
    this.remainder = new Float32Array(0);
  }

  private consume(input: Float32Array, sampleRate: number): void {
    const resampled = resampleLinear(input, sampleRate, TARGET_RATE);
    const combined = concat([this.remainder, resampled]);
    let offset = 0;
    while (offset + FRAME_SAMPLES <= combined.length) {
      this.pushFrame(combined.subarray(offset, offset + FRAME_SAMPLES));
      offset += FRAME_SAMPLES;
    }
    this.remainder = combined.slice(offset);
  }

  private pushFrame(frame: Float32Array): void {
    const copy = new Float32Array(frame);
    const level = rms(copy);
    const threshold = Math.max(0.012, this.noise * 3.2);
    const speaking = level >= threshold;
    if (!speaking) this.noise = this.noise * 0.96 + level * 0.04;
    this.frames.push(copy);
    if (speaking) {
      this.voiced = true;
      this.speechMs += FRAME_MS;
      this.silenceMs = 0;
    } else if (this.voiced) {
      this.silenceMs += FRAME_MS;
    } else {
      const preroll = Math.ceil(200 / FRAME_MS);
      while (this.frames.length > preroll) this.frames.shift();
    }
    const lengthMs = this.frames.length * FRAME_MS;
    if (this.voiced && (this.silenceMs >= SILENCE_MS || lengthMs >= MAX_UTTERANCE_MS)) {
      this.flush(this.mode, false);
    }
  }

  private flush(mode: SpeechMode, manual: boolean): void {
    if (!this.voiced || this.speechMs < (manual ? 180 : MIN_SPEECH_MS)) {
      this.resetUtterance();
      return;
    }
    const trailing = Math.floor(this.silenceMs / FRAME_MS);
    const keep = Math.ceil(100 / FRAME_MS);
    const drop = Math.max(0, trailing - keep);
    const used = drop > 0 ? this.frames.slice(0, this.frames.length - drop) : this.frames.slice();
    const audio = concat(used);
    this.resetUtterance();
    if (audio.length < TARGET_RATE * 0.15) return;
    this.enqueue(audio, mode);
  }

  private resetUtterance(): void {
    this.frames = [];
    this.speechMs = 0;
    this.silenceMs = 0;
    this.voiced = false;
  }

  private enqueue(audio: Float32Array, mode: SpeechMode): void {
    const ms = (audio.length / TARGET_RATE) * 1000;
    this.queue.push({ audio, mode });
    this.queueMs += ms;
    while (this.queueMs > MAX_QUEUE_MS && this.queue.length > 1) {
      const dropped = this.queue.shift();
      if (!dropped) break;
      this.queueMs -= (dropped.audio.length / TARGET_RATE) * 1000;
    }
    if (!this.modelReady) {
      this.store.setCommandMessage('Speech is queued until the model finishes loading.');
    }
    this.pump();
  }

  private pump(): void {
    if (!this.worker || this.busy || !this.modelReady || this.queue.length === 0) return;
    const next = this.queue.shift();
    if (!next) return;
    this.queueMs -= (next.audio.length / TARGET_RATE) * 1000;
    this.busy = true;
    const id = this.nextId;
    this.nextId += 1;
    this.pendingModes.set(id, next.mode);
    this.store.setSpeech({ transcribing: true });
    this.worker.postMessage({ type: 'transcribe', id, audio: next.audio }, [next.audio.buffer]);
  }

  private onWorker(message: WorkerMessage): void {
    if (message.type === 'progress') {
      const progress = Math.max(0, Math.min(100, message.progress));
      const amount = formatBytes(message.loaded);
      const total = formatBytes(message.total);
      const size = amount && total ? ` (${amount} of ${total})` : '';
      this.store.setSpeech({
        model: progress >= 100 ? 'loading' : 'downloading',
        progress,
        message: progress >= 100 ? 'Loading speech model…' : `Downloading speech model — ${Math.round(progress)}%${size}`,
      });
      return;
    }
    if (message.type === 'ready') {
      this.modelReady = true;
      this.store.setSpeech({ model: 'ready', progress: 100, message: 'Speech model ready', transcribing: false });
      this.pump();
      return;
    }
    if (message.type === 'error') {
      this.modelReady = false;
      this.store.setSpeech({
        model: 'error',
        message: `WebGPU could not start the speech model. Writing tools still work. ${message.message}`,
      });
      return;
    }
    if (message.type === 'result') {
      this.busy = false;
      const mode = this.pendingModes.get(message.id) ?? 'narration';
      this.pendingModes.delete(message.id);
      this.store.setSpeech({ transcribing: this.queue.length > 0 });
      if (message.error) this.store.setCommandMessage(message.error);
      else if (message.text.trim()) this.store.takeUtterance(message.text, mode);
      this.pump();
    }
  }
}
