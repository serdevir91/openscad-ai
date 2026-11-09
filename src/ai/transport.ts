// One way to reach models and OpenSCAD: Rust commands on the desktop, direct calls in a browser.
import { commands, desktop, type Config, type ProviderStatus } from '../hooks/useTauriCommands';
import type { Compiled, Completion } from './pipeline';
import { available, provider } from './providers';

const stopped = () => new DOMException('Stopped', 'AbortError');

/** Rejects as soon as the signal fires, even if the task itself cannot be interrupted. */
function until<T>(task: Promise<T>, signal?: AbortSignal) {
  if (signal?.aborted) return Promise.reject<T>(stopped());
  return new Promise<T>((resolve, reject) => {
    const stop = () => reject(stopped());
    signal?.addEventListener('abort', stop, { once: true });
    task.then(resolve, reject).finally(() => signal?.removeEventListener('abort', stop));
  });
}

function endpoint(config: Config) {
  const url = (config.base_urls[config.provider] || provider(config.provider).baseUrl || '').trim().replace(/\/+$/, '');
  if (!url) throw new Error('Enter the endpoint URL for this provider in Connections.');
  return url;
}

function apiKey(config: Config) {
  const key = (config.keys[config.provider] ?? '').trim();
  if (!key && provider(config.provider).group === 'cloud') throw new Error('Add an API key for this provider in Connections.');
  return key;
}

async function json(response: Response) {
  const text = await response.text();
  let value: Record<string, unknown> | undefined;
  try { value = JSON.parse(text); } catch { /* Reported below. */ }
  if (!response.ok) {
    const error = value?.error as { message?: string } | string | undefined;
    const reason = typeof error === 'string' ? error : error?.message;
    throw new Error(`The provider returned HTTP ${response.status}${reason ? `: ${reason.slice(0, 400)}` : ''}`);
  }
  if (!value) throw new Error('The provider returned invalid JSON.');
  return value as Record<string, any>;
}

async function gemini(config: Config, request: Completion, signal?: AbortSignal) {
  const parts: unknown[] = [{ text: request.prompt }, ...(request.images ?? []).map(image => ({ inline_data: { mime_type: image.mime, data: image.data } }))];
  const reply = await json(await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey(config) },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      ...(request.system ? { system_instruction: { parts: [{ text: request.system }] } } : {}),
      ...(request.json ? { generationConfig: { responseMimeType: 'application/json' } } : {}),
    }),
  }));
  const candidate = reply.candidates?.[0];
  if (candidate?.finishReason === 'MAX_TOKENS') throw new Error('The response hit the output limit; ask for a simpler model.');
  return (candidate?.content?.parts ?? []).filter((part: { thought?: boolean }) => !part.thought).map((part: { text?: string }) => part.text ?? '').join('\n');
}

async function anthropic(config: Config, request: Completion, signal?: AbortSignal) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: apiKey(config), dangerouslyAllowBrowser: true, maxRetries: 1 });
  const stream = client.messages.stream({
    model: config.model,
    max_tokens: 32000,
    ...(request.system ? { system: request.system } : {}),
    // Effort is rejected by older models, and this family defaults to a lower setting.
    ...(config.mode === 'precise' && /^claude-(opus|sonnet|fable|haiku)-5/.test(config.model) ? { output_config: { effort: 'high' as const } } : {}),
    messages: [{
      role: 'user',
      content: [
        ...(request.images ?? []).map(image => ({
          type: 'image' as const,
          source: { type: 'base64' as const, media_type: image.mime as 'image/png', data: image.data },
        })),
        { type: 'text' as const, text: request.prompt },
      ],
    }],
  }, { signal });
  const message = await stream.finalMessage();
  if (message.stop_reason === 'refusal') throw new Error('Claude declined this request.');
  if (message.stop_reason === 'max_tokens') throw new Error('The response hit the output limit; ask for a simpler model.');
  return message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n');
}

const OPENAI_URLS: Record<string, string> = { openai: 'https://api.openai.com/v1', openrouter: 'https://openrouter.ai/api/v1' };

async function openAiCompatible(config: Config, request: Completion, signal?: AbortSignal) {
  const key = apiKey(config);
  const images = request.images ?? [];
  const user = images.length
    ? [{ type: 'text', text: request.prompt }, ...images.map(image => ({ type: 'image_url', image_url: { url: `data:${image.mime};base64,${image.data}` } }))]
    : request.prompt;
  const reply = await json(await fetch(`${OPENAI_URLS[config.provider] ?? endpoint(config)}/chat/completions`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({
      model: config.model,
      messages: [...(request.system ? [{ role: 'system', content: request.system }] : []), { role: 'user', content: user }],
      ...(request.json && config.provider !== 'custom' ? { response_format: { type: 'json_object' } } : {}),
    }),
  }));
  if (reply.choices?.[0]?.finish_reason === 'length') throw new Error('The response hit the output limit; ask for a simpler model.');
  return String(reply.choices?.[0]?.message?.content ?? '');
}

async function ollama(config: Config, request: Completion, signal?: AbortSignal) {
  const reply = await json(await fetch(`${endpoint(config)}/api/chat`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.model,
      stream: false,
      options: { temperature: 0.2 },
      ...(request.json ? { format: 'json' } : {}),
      messages: [
        ...(request.system ? [{ role: 'system', content: request.system }] : []),
        { role: 'user', content: request.prompt, ...(request.images?.length ? { images: request.images.map(image => image.data) } : {}) },
      ],
    }),
  }));
  return String(reply.message?.content ?? '');
}

export async function complete(config: Config, request: Completion, signal?: AbortSignal): Promise<string> {
  if (desktop) return until(commands.complete({ images: [], ...request }), signal);
  if (!config.model.trim()) throw new Error('Choose a model for this provider.');
  const call = config.provider === 'gemini' ? gemini : config.provider === 'anthropic' ? anthropic : config.provider === 'ollama' ? ollama : openAiCompatible;
  const text = await call(config, request, signal);
  if (!text.trim()) throw new Error('The provider returned an empty response.');
  return text;
}

type WorkerReply = { id: number; ok: boolean; bytes?: ArrayBuffer; error?: string; log?: string };
let worker: Worker | undefined;
let sequence = 0;
const pending = new Map<number, { resolve: (value: Compiled) => void; reject: (reason: Error) => void }>();

function dropWorker(reason: Error) {
  worker?.terminate();
  worker = undefined;
  for (const request of pending.values()) request.reject(reason);
  pending.clear();
}

function openscadWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('../workers/openscad.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<WorkerReply>) => {
    const request = pending.get(event.data.id);
    if (!request) return;
    pending.delete(event.data.id);
    if (event.data.ok && event.data.bytes) request.resolve({ bytes: new Uint8Array(event.data.bytes), log: event.data.log ?? '' });
    else request.reject(new Error(event.data.error || event.data.log || 'OpenSCAD WebAssembly compilation failed.'));
  };
  worker.onerror = event => dropWorker(new Error(event.message || 'OpenSCAD WebAssembly stopped unexpectedly.'));
  return worker;
}

function compileWasm(code: string, format: string, seconds: number, signal?: AbortSignal) {
  const id = ++sequence;
  const baseUrl = new URL('openscad/', document.baseURI).href;
  return new Promise<Compiled>((resolve, reject) => {
    const stop = () => dropWorker(stopped());
    const timer = setTimeout(() => dropWorker(new Error(`OpenSCAD timed out after ${seconds} seconds. Lower $fn or simplify the model.`)), seconds * 1000);
    const finish = () => { clearTimeout(timer); signal?.removeEventListener('abort', stop); };
    signal?.addEventListener('abort', stop, { once: true });
    pending.set(id, { resolve: value => { finish(); resolve(value); }, reject: error => { finish(); reject(error); } });
    openscadWorker().postMessage({ id, code, baseUrl, format });
  });
}

let nativeMissing = false;

async function compileNative(code: string, format: string, signal?: AbortSignal): Promise<Compiled> {
  const reply = new Uint8Array(await until(commands.compile(code, format), signal));
  const length = new DataView(reply.buffer, reply.byteOffset).getUint32(0, true);
  return { log: new TextDecoder().decode(reply.subarray(4, 4 + length)), bytes: reply.slice(4 + length) };
}

/** Uses the installed OpenSCAD when there is one. The bundled WebAssembly build covers the rest. */
export async function compile(config: Config, code: string, format: string, signal?: AbortSignal): Promise<Compiled> {
  if (desktop && !nativeMissing) {
    try {
      return await compileNative(code, format, signal);
    } catch (error) {
      if (!String(error).includes('OpenSCAD CLI was not found')) throw typeof error === 'string' ? new Error(error) : error;
      nativeMissing = true;
    }
  }
  return compileWasm(code, format, config.render_timeout, signal);
}

export function nativeFound() {
  nativeMissing = false;
}

export function docs(prompt: string) {
  return desktop ? commands.docs(prompt) : Promise.resolve('');
}

export async function listModels(config: Config, id: string): Promise<string[]> {
  if (desktop) return commands.models(config, id);
  const active = { ...config, provider: id };
  const key = (active.keys[id] ?? '').trim();
  if (id === 'gemini') {
    const reply = await json(await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', { headers: { 'x-goog-api-key': apiKey(active) } }));
    return (reply.models ?? [])
      .filter((model: { supportedGenerationMethods?: string[] }) => model.supportedGenerationMethods?.includes('generateContent'))
      .map((model: { name: string }) => model.name.replace(/^models\//, ''));
  }
  if (id === 'anthropic') {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const page = await new Anthropic({ apiKey: apiKey(active), dangerouslyAllowBrowser: true }).models.list({ limit: 100 });
    return page.data.map(model => model.id);
  }
  if (id === 'ollama') {
    const reply = await json(await fetch(`${endpoint(active)}/api/tags`));
    return (reply.models ?? []).map((model: { name: string }) => model.name);
  }
  const reply = await json(await fetch(`${OPENAI_URLS[id] ?? endpoint(active)}/models`, { headers: key ? { Authorization: `Bearer ${key}` } : {} }));
  const names: string[] = (reply.data ?? []).map((model: { id: string }) => model.id).sort();
  return id === 'openai' ? names.filter(name => /^(gpt-|o\d)/.test(name)) : names;
}

export async function statuses(config: Config): Promise<ProviderStatus[]> {
  if (desktop) return commands.providers(config);
  return available(false).map(item => {
    const key = Boolean(config.keys[item.id]?.trim());
    if (item.group === 'cloud') return { id: item.id, ready: key, detail: key ? 'API key saved' : 'No API key yet' };
    return { id: item.id, ready: false, detail: 'Test the connection to check it' };
  });
}

export async function testProvider(config: Config): Promise<string> {
  if (desktop) return commands.test(config);
  return complete(config, { system: '', prompt: 'Reply with exactly: OK' });
}

export async function saveFile(name: string, data: Uint8Array | string, type: string) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  if (desktop) return commands.saveBytes(name, bytes);
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
  return name;
}

export function openLink(url: string) {
  if (desktop) void commands.openUrl(url);
  else window.open(url, '_blank', 'noreferrer');
}

export function saveDesign(code: string, stl: Uint8Array) {
  const source = new TextEncoder().encode(code);
  const body = new Uint8Array(4 + source.length + stl.length);
  new DataView(body.buffer).setUint32(0, source.length, true);
  body.set(source, 4);
  body.set(stl, 4 + source.length);
  return commands.saveOutput(body);
}

/** True when `latest` is a newer dotted version than `current`. */
export function isNewer(latest: string, current: string) {
  const a = latest.split('.').map(Number), b = current.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const difference = (a[i] || 0) - (b[i] || 0);
    if (difference) return difference > 0;
  }
  return false;
}
