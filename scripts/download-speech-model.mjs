#!/usr/bin/env node
/**
 * Download the Parakeet files the speech worker fetches, so a static deploy
 * can serve them from the same origin.
 *
 * Model files are whatever ModelRegistry.get_pipeline_files returns for the
 * same task, model, device, and dtype as src/speech-worker.ts. That list is
 * checked against src/speech-model.ts. The wasm pair is the WebGPU asyncify
 * build Transformers.js loads from jsDelivr for the installed onnxruntime-web.
 */
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { ModelRegistry } from '@huggingface/transformers';
import {
  LOCAL_MODEL_DIR,
  LOCAL_WASM_DIR,
  SPEECH_MODEL_DEVICE,
  SPEECH_MODEL_DTYPE,
  SPEECH_MODEL_FILES,
  SPEECH_MODEL_ID,
  SPEECH_PIPELINE_TASK,
  SPEECH_WASM_FILES,
} from '../src/speech-model.ts';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const publicModels = join(repoRoot, 'public', LOCAL_MODEL_DIR);
const modelDir = join(publicModels, SPEECH_MODEL_ID);
const wasmDir = join(repoRoot, 'public', LOCAL_WASM_DIR);

const HF_HOST = 'https://huggingface.co/';
const HF_TEMPLATE = '{model}/resolve/{revision}/';

function pathJoin(...parts) {
  return parts
    .map((part, index) => {
      let next = part;
      if (index) next = next.replace(/^\//, '');
      if (index !== parts.length - 1) next = next.replace(/\/$/, '');
      return next;
    })
    .join('/');
}

function huggingfaceFileUrl(filename) {
  const prefix = HF_TEMPLATE.replaceAll('{model}', SPEECH_MODEL_ID).replaceAll('{revision}', 'main');
  return pathJoin(HF_HOST, prefix, filename);
}

async function onnxRuntimeVersion() {
  const packageJson = JSON.parse(
    await readFile(join(repoRoot, 'node_modules/onnxruntime-web/package.json'), 'utf8'),
  );
  return packageJson.version;
}

function wasmCdnUrl(version, filename) {
  return `https://cdn.jsdelivr.net/npm/onnxruntime-web@${version}/dist/${filename}`;
}

function sameFiles(actual, expected) {
  const left = [...actual].sort();
  const right = [...expected].sort();
  return left.length === right.length && left.every((file, index) => file === right[index]);
}

async function fileSize(path) {
  try {
    const info = await stat(path);
    return info.size;
  } catch (error) {
    if (error && error.code === 'ENOENT') return -1;
    throw error;
  }
}

async function download(url, destination) {
  const existing = await fileSize(destination);
  const response = await fetch(url, {
    redirect: 'follow',
    headers: { 'Accept-Encoding': 'identity' },
  });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (${response.status}) for ${url}`);
  }
  const expected = Number(response.headers.get('content-length') ?? '0');
  if (existing >= 0 && expected > 0 && existing === expected) {
    await response.body.cancel();
    console.log(`kept ${destination} (${existing} bytes)`);
    return;
  }
  await mkdir(dirname(destination), { recursive: true });
  const partial = `${destination}.partial`;
  try {
    await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
  } catch (error) {
    await rm(partial, { force: true });
    throw error;
  }
  const written = await fileSize(partial);
  if (expected > 0 && written < expected) {
    await rm(partial, { force: true });
    throw new Error(`Short download for ${url}: wrote ${written} of ${expected} bytes`);
  }
  await rename(partial, destination);
  console.log(`saved ${destination} (${written} bytes)`);
}

function licenseText() {
  return `NVIDIA Parakeet CTC 0.6B
ONNX conversion: onnx-community/parakeet-ctc-0.6b-ONNX

These weights are licensed under the Creative Commons Attribution 4.0
International License (CC-BY-4.0):

https://creativecommons.org/licenses/by/4.0/

Credit NVIDIA for Parakeet CTC 0.6B and onnx-community for the ONNX
conversion, link to the license above, and note any changes you make.
Keep this file with the weights if you redistribute them.
`;
}

async function main() {
  const files = await ModelRegistry.get_pipeline_files(SPEECH_PIPELINE_TASK, SPEECH_MODEL_ID, {
    device: SPEECH_MODEL_DEVICE,
    dtype: SPEECH_MODEL_DTYPE,
  });
  if (!sameFiles(files, SPEECH_MODEL_FILES)) {
    throw new Error(
      `Transformers.js wants different speech files than src/speech-model.ts.\n` +
        `Library: ${files.join(', ')}\n` +
        `App: ${SPEECH_MODEL_FILES.join(', ')}`,
    );
  }

  console.log(`Downloading ${SPEECH_MODEL_ID} (${SPEECH_MODEL_DTYPE}, ${SPEECH_MODEL_DEVICE})`);
  for (const file of SPEECH_MODEL_FILES) {
    await download(huggingfaceFileUrl(file), join(modelDir, file));
  }

  const version = await onnxRuntimeVersion();
  console.log(`Downloading onnxruntime-web@${version} wasm`);
  for (const file of SPEECH_WASM_FILES) {
    await download(wasmCdnUrl(version, file), join(wasmDir, file));
  }

  const licensePath = join(modelDir, 'onnx', 'LICENSE');
  await mkdir(dirname(licensePath), { recursive: true });
  await writeFile(licensePath, licenseText());
  console.log(`saved ${licensePath}`);
  console.log('Speech model is ready in public/models/.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
