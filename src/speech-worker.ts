import { env, pipeline, type ProgressInfo } from '@huggingface/transformers';
import {
  SPEECH_MODEL_DEVICE,
  SPEECH_MODEL_DTYPE,
  SPEECH_MODEL_ID,
  localSpeechAvailability,
  speechAssetPaths,
} from './speech-model';

env.allowLocalModels = false;
env.useBrowserCache = true;
env.useFSCache = false;

type Inbound =
  | { type: 'load'; basePath?: string }
  | { type: 'transcribe'; id: number; audio: Float32Array };

let transcriber: Awaited<ReturnType<typeof pipeline<'automatic-speech-recognition'>>> | null = null;

function post(message: Record<string, unknown>): void {
  self.postMessage(message);
}

self.onmessage = (event: MessageEvent<Inbound>) => {
  const message = event.data;
  if (message.type === 'load') {
    void loadModel(message.basePath ?? '/');
    return;
  }
  if (message.type === 'transcribe') {
    void transcribe(message.id, message.audio);
  }
};

/**
 * Prefer the files from `npm run download-model` when every one of them is
 * already on this origin. Missing files keep the network path: Hugging Face
 * for the model (browser Cache API) and jsDelivr for the wasm runtime.
 */
async function useLocalAssets(basePath: string): Promise<void> {
  const available = await localSpeechAvailability(basePath);
  const paths = speechAssetPaths(basePath);
  if (available.model) {
    env.allowLocalModels = true;
    env.localModelPath = paths.localModelPath;
    env.useBrowserCache = false;
  }
  if (available.wasm && env.backends.onnx.wasm) {
    env.backends.onnx.wasm.wasmPaths = paths.wasm;
  }
}

async function loadModel(basePath: string): Promise<void> {
  try {
    await useLocalAssets(basePath);
    post({ type: 'status', message: 'Downloading speech model…' });
    transcriber = await pipeline('automatic-speech-recognition', SPEECH_MODEL_ID, {
      device: SPEECH_MODEL_DEVICE,
      dtype: SPEECH_MODEL_DTYPE,
      progress_callback: (info: ProgressInfo) => {
        if (info.status === 'progress_total') {
          post({
            type: 'progress',
            progress: info.progress,
            loaded: info.loaded,
            total: info.total,
          });
        } else if (info.status === 'progress') {
          post({ type: 'file-progress', file: info.file, progress: info.progress });
        }
      },
    });
    post({ type: 'ready' });
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
}

async function transcribe(id: number, audio: Float32Array): Promise<void> {
  if (!transcriber) {
    post({ type: 'result', id, text: '', error: 'Speech model is not ready.' });
    return;
  }
  try {
    const output = await transcriber(audio);
    const text = Array.isArray(output) ? output.map((item) => item.text).join(' ') : output.text;
    post({ type: 'result', id, text });
  } catch (error) {
    post({
      type: 'result',
      id,
      text: '',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
