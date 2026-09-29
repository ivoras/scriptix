import { env, pipeline, type ProgressInfo } from '@huggingface/transformers';

const MODEL_ID = 'onnx-community/parakeet-ctc-0.6b-ONNX';

env.allowLocalModels = false;
env.useBrowserCache = true;
env.useFSCache = false;

type Inbound =
  | { type: 'load' }
  | { type: 'transcribe'; id: number; audio: Float32Array };

let transcriber: Awaited<ReturnType<typeof pipeline<'automatic-speech-recognition'>>> | null = null;

function post(message: Record<string, unknown>): void {
  self.postMessage(message);
}

self.onmessage = (event: MessageEvent<Inbound>) => {
  const message = event.data;
  if (message.type === 'load') {
    void loadModel();
    return;
  }
  if (message.type === 'transcribe') {
    void transcribe(message.id, message.audio);
  }
};

async function loadModel(): Promise<void> {
  try {
    post({ type: 'status', message: 'Downloading speech model…' });
    transcriber = await pipeline('automatic-speech-recognition', MODEL_ID, {
      device: 'webgpu',
      dtype: 'q4f16',
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
