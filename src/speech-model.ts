/**
 * Assets the speech worker loads for NVIDIA Parakeet CTC 0.6B.
 *
 * Transformers.js (`@huggingface/transformers` 4.3.0) fetches these when
 * `pipeline('automatic-speech-recognition', SPEECH_MODEL_ID, { device, dtype })`
 * runs in the browser:
 *
 * - Model files come from `https://huggingface.co/{model}/resolve/main/{file}`
 *   and are stored in the Cache API (`env.useBrowserCache`, cache name
 *   `transformers-cache`) unless a same-origin copy is present.
 * - `dtype: 'q4f16'` selects `onnx/model_q4f16.onnx`. The model config sets
 *   `transformers.js_config.use_external_data_format` to true, so the weights
 *   are the sibling file `onnx/model_q4f16.onnx_data`.
 * - The task is multimodal, so the loader also requests `tokenizer.json`,
 *   `tokenizer_config.json`, and `preprocessor_config.json`.
 * - The WebGPU backend then loads ONNX Runtime's asyncify wasm pair from
 *   `https://cdn.jsdelivr.net/npm/onnxruntime-web@{version}/dist/`.
 *   The version is the installed `onnxruntime-web` package.
 *
 * `localModelPath` must be an origin path such as `/models/`, not an http URL.
 * Transformers.js skips the local existence check for http(s) URLs and would
 * fall through to the Hugging Face host.
 */

export const SPEECH_MODEL_ID = 'onnx-community/parakeet-ctc-0.6b-ONNX';
export const SPEECH_PIPELINE_TASK = 'automatic-speech-recognition';
export const SPEECH_MODEL_DEVICE = 'webgpu';
export const SPEECH_MODEL_DTYPE = 'q4f16';

/** Same list `ModelRegistry.get_pipeline_files` returns for the call above. */
export const SPEECH_MODEL_FILES = [
  'config.json',
  'onnx/model_q4f16.onnx',
  'onnx/model_q4f16.onnx_data',
  'tokenizer.json',
  'tokenizer_config.json',
  'preprocessor_config.json',
] as const;

/** Filenames set on `env.backends.onnx.wasm.wasmPaths` for WebGPU. */
export const SPEECH_WASM_FILES = [
  'ort-wasm-simd-threaded.asyncify.mjs',
  'ort-wasm-simd-threaded.asyncify.wasm',
] as const;

export const LOCAL_MODEL_DIR = 'models/';
export const LOCAL_WASM_DIR = 'models/onnxruntime/';

export function normalizeBasePath(basePath: string): string {
  const raw = basePath.startsWith('http://') || basePath.startsWith('https://') ? new URL(basePath).pathname : basePath;
  const withSlash = raw.startsWith('/') ? raw : `/${raw}`;
  return withSlash.endsWith('/') ? withSlash : `${withSlash}/`;
}

export function speechAssetPaths(basePath: string): {
  localModelPath: string;
  modelFiles: string[];
  wasm: { mjs: string; wasm: string };
} {
  const prefix = normalizeBasePath(basePath);
  const modelRoot = `${prefix}${LOCAL_MODEL_DIR}${SPEECH_MODEL_ID}/`;
  const wasmRoot = `${prefix}${LOCAL_WASM_DIR}`;
  const [mjsName, wasmName] = SPEECH_WASM_FILES;
  return {
    localModelPath: `${prefix}${LOCAL_MODEL_DIR}`,
    modelFiles: SPEECH_MODEL_FILES.map((file) => `${modelRoot}${file}`),
    wasm: {
      mjs: `${wasmRoot}${mjsName}`,
      wasm: `${wasmRoot}${wasmName}`,
    },
  };
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** True when a same-origin static file is actually there, not an HTML fallback. */
export async function localFileReady(url: string, fetchImpl: FetchLike = fetch): Promise<boolean> {
  try {
    let response = await fetchImpl(url, { method: 'HEAD', cache: 'no-store' });
    if (response.status === 405 || response.status === 501) {
      response = await fetchImpl(url, {
        method: 'GET',
        headers: { Range: 'bytes=0-0' },
        cache: 'no-store',
      });
    }
    if (!response.ok && response.status !== 206) return false;
    const type = response.headers.get('content-type') ?? '';
    return !type.includes('text/html');
  } catch {
    return false;
  }
}

export async function localSpeechAvailability(
  basePath: string,
  fetchImpl: FetchLike = fetch,
): Promise<{ model: boolean; wasm: boolean }> {
  const paths = speechAssetPaths(basePath);
  const [modelChecks, wasmChecks] = await Promise.all([
    Promise.all(paths.modelFiles.map((url) => localFileReady(url, fetchImpl))),
    Promise.all([localFileReady(paths.wasm.mjs, fetchImpl), localFileReady(paths.wasm.wasm, fetchImpl)]),
  ]);
  return {
    model: modelChecks.every(Boolean),
    wasm: wasmChecks.every(Boolean),
  };
}
