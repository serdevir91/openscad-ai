import { invoke, isTauri } from '@tauri-apps/api/core';

export type Theme = 'dark' | 'amoled' | 'light';
export type Provider = 'gemini' | 'openai' | 'ollama' | 'codex';
export type Config = {
  provider: Provider; model: string; gemini_key: string; openai_key: string;
  openscad_path: string; codex_path: string; output_dir: string; theme: Theme; max_repairs: number;
};
export type ReferenceImage = { mime: string; data: string };
export type Artifact = { code: string; stl: string; name: string };
export type SavedModel = { name: string; modified: number };
export const defaults: Config = {
  provider: 'gemini', model: 'gemini-2.5-flash', gemini_key: '', openai_key: '',
  openscad_path: '', codex_path: '', output_dir: '', theme: 'dark', max_repairs: 2,
};
export function isDesktop(): boolean {
  if (typeof window === 'undefined') return false;
  const tauriWindow = window as Window & { isTauri?: boolean; __TAURI_INTERNALS__?: unknown; __TAURI__?: unknown };
  return Boolean(tauriWindow.isTauri) || '__TAURI_INTERNALS__' in tauriWindow || '__TAURI__' in tauriWindow;
}
export const desktop = isDesktop();
function call<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  if (!isDesktop()) return Promise.reject(new Error('Run the desktop app (run-app.bat or npm run desktop) to use local OpenSCAD and AI features.'));
  return invoke<T>(name, args);
}
export const commands = {
  load: () => call<Config>('load_config'),
  save: (config: Config) => call<void>('save_config', { config }),
  detect: () => call<string>('detect_openscad'),
  detectCodex: (config: Config) => call<string>('detect_codex', { config }),
  chooseOutput: (current: string) => call<string | null>('choose_output_directory', { current }),
  generate: (prompt: string, code: string, image?: ReferenceImage, skills?: string[]) => call<Artifact>('generate', { request: { prompt, code, image: image ?? null, skills: skills ?? [] } }),
  render: (code: string) => call<Artifact>('render', { code }),
  sync: () => call<number>('sync_docs'),
  export: (code: string, format: 'scad' | 'stl' | 'png') => call<string | null>('export_file', { code, format }),
  outputs: () => call<string>('output_directory'),
  cancel: () => call<void>('cancel_operation'),
  models: (config: Config) => call<string[]>('list_models', { config }),
  analyze: (config: Config, image: ReferenceImage) => call<string>('analyze_image', { config, image }),
  listOutputs: () => call<SavedModel[]>('list_outputs'),
  readOutput: (name: string) => call<string>('read_output', { name }),
};
