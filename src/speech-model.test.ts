import { describe, expect, it } from 'vitest';
import {
  SPEECH_MODEL_FILES,
  localFileReady,
  localSpeechAvailability,
  speechAssetPaths,
} from './speech-model';

describe('speech model paths', () => {
  it('points a static deploy at the downloaded Parakeet files', () => {
    const paths = speechAssetPaths('/scriptix/');
    expect(paths.localModelPath).toBe('/scriptix/models/');
    expect(paths.modelFiles).toEqual([
      '/scriptix/models/onnx-community/parakeet-ctc-0.6b-ONNX/config.json',
      '/scriptix/models/onnx-community/parakeet-ctc-0.6b-ONNX/onnx/model_q4f16.onnx',
      '/scriptix/models/onnx-community/parakeet-ctc-0.6b-ONNX/onnx/model_q4f16.onnx_data',
      '/scriptix/models/onnx-community/parakeet-ctc-0.6b-ONNX/tokenizer.json',
      '/scriptix/models/onnx-community/parakeet-ctc-0.6b-ONNX/tokenizer_config.json',
      '/scriptix/models/onnx-community/parakeet-ctc-0.6b-ONNX/preprocessor_config.json',
    ]);
    expect(paths.wasm).toEqual({
      mjs: '/scriptix/models/onnxruntime/ort-wasm-simd-threaded.asyncify.mjs',
      wasm: '/scriptix/models/onnxruntime/ort-wasm-simd-threaded.asyncify.wasm',
    });
  });

  it('normalizes a site hosted at the domain root', () => {
    expect(speechAssetPaths('/').localModelPath).toBe('/models/');
    expect(speechAssetPaths('').modelFiles[1]).toBe(
      '/models/onnx-community/parakeet-ctc-0.6b-ONNX/onnx/model_q4f16.onnx',
    );
  });

  it('treats an HTML fallback as missing and accepts the real files', async () => {
    const fetchImpl = async (url: string) => {
      if (url.endsWith('.html') || url.endsWith('missing.bin')) {
        return new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } });
      }
      return new Response('ok', { status: 200, headers: { 'content-type': 'application/octet-stream' } });
    };
    expect(await localFileReady('/models/missing.bin', fetchImpl)).toBe(false);
    expect(await localFileReady('/models/config.json', fetchImpl)).toBe(true);

    const ready = await localSpeechAvailability('/', async (url) => {
      if (String(url).includes('onnxruntime')) {
        return new Response('', { status: 404 });
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    });
    expect(ready).toEqual({ model: true, wasm: false });
    expect(SPEECH_MODEL_FILES).toHaveLength(6);
  });
});
