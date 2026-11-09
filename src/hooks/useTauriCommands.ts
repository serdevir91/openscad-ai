import { invoke } from '@tauri-apps/api/core';

export type Theme = 'dark' | 'amoled' | 'light';
export type Config = {
  provider: string; model: string; models: Record<string, string>;
  keys: Record<string, string>; base_urls: Record<string, string>; paths: Record<string, string>;
  openscad_path: string; output_dir: string; theme: Theme; max_repairs: number;
  mode: 'precise' | 'fast'; render_timeout: number; onboarded: boolean;
};
export type ReferenceImage = { mime: string; data: string };
export type SavedModel = { name: string; modified: number };
export type ProviderStatus = { id: string; ready: boolean; detail: string; path?: string | null };
export type Release = { version: string; url: string };
export const defaults: Config = {
  provider: 'gemini', model: 'gemini-flash-latest', models: {}, keys: {}, base_urls: {}, paths: {},
  openscad_path: '', output_dir: '', theme: 'dark', max_repairs: 3, mode: 'precise', render_timeout: 120, onboarded: false,
};
export function isDesktop(): boolean {
  if (typeof window === 'undefined') return false;
  const tauriWindow = window as Window & { isTauri?: boolean; __TAURI_INTERNALS__?: unknown; __TAURI__?: unknown };
  return Boolean(tauriWindow.isTauri) || '__TAURI_INTERNALS__' in tauriWindow || '__TAURI__' in tauriWindow;
}
export const desktop = isDesktop();
function call<T>(name: string, args?: Parameters<typeof invoke>[1], options?: Parameters<typeof invoke>[2]): Promise<T> {
  if (!isDesktop()) return Promise.reject(new Error('This action needs the desktop app.'));
  return invoke<T>(name, args, options);
}
export const commands = {
  load: () => call<Config>('load_config'),
  save: (config: Config) => call<void>('save_config', { config }),
  detect: () => call<{ path: string; version: string }>('detect_openscad'),
  providers: (config: Config) => call<ProviderStatus[]>('detect_providers', { config }),
  test: (config: Config) => call<string>('test_provider', { config }),
  login: (config: Config, provider: string) => call<void>('open_login', { config, provider }),
  chooseOutput: (current: string) => call<string | null>('choose_output_directory', { current }),
  complete: (request: unknown) => call<string>('ai_complete', { request }),
  compile: (code: string, format: string) => call<ArrayBuffer>('compile_scad', { code, format }),
  docs: (prompt: string) => call<string>('docs_context', { prompt }),
  sync: () => call<number>('sync_docs'),
  saveOutput: (body: Uint8Array) => call<string>('save_output', body),
  saveBytes: (name: string, bytes: Uint8Array) => call<string | null>('save_bytes', bytes, { headers: { 'x-name': name } }),
  openUrl: (url: string) => call<void>('open_url', { url }),
  latestRelease: () => call<Release | null>('latest_release'),
  outputs: () => call<string>('output_directory'),
  cancel: () => call<void>('cancel_operation'),
  models: (config: Config, provider: string) => call<string[]>('list_models', { config, provider }),
  listOutputs: () => call<SavedModel[]>('list_outputs'),
  readOutput: (name: string) => call<string>('read_output', { name }),
};
