// Everything the interface knows about a provider. Calls themselves live in transport.ts
// for the browser and in src-tauri/src/ai for the desktop app.

export type ProviderGroup = 'cli' | 'cloud' | 'local';
export type ProviderId =
  | 'claude-code' | 'codex' | 'gemini-cli' | 'opencode' | 'antigravity'
  | 'gemini' | 'openai' | 'anthropic' | 'openrouter' | 'groq' | 'deepseek' | 'mistral' | 'xai'
  | 'ollama' | 'lmstudio' | 'custom';

export type Provider = {
  id: ProviderId;
  name: string;
  note: string;
  group: ProviderGroup;
  /** Used when the user has not chosen a model. Empty means the provider picks its own. */
  model: string;
  presets: { id: string; label: string }[];
  keyUrl?: string;
  keyHint?: string;
  baseUrl?: string;
  install?: string;
  installUrl?: string;
  /** Terminal sign-in, for a CLI that has one the app can start. */
  login?: string;
  /** Reachable straight from a web page, without the desktop app. */
  web?: boolean;
  /** Can look at rendered views. Models without vision skip that review step. */
  vision?: boolean;
};

export const PROVIDERS: Provider[] = [
  {
    id: 'claude-code', name: 'Claude Code', note: 'Your Claude subscription, no API key', group: 'cli', model: '',
    presets: [{ id: 'opus', label: 'Opus' }, { id: 'sonnet', label: 'Sonnet' }, { id: 'haiku', label: 'Haiku' }],
    install: 'curl -fsSL https://claude.ai/install.sh | bash', installUrl: 'https://code.claude.com/docs/en/setup',
    login: 'claude auth login', vision: true,
  },
  {
    id: 'codex', name: 'Codex CLI', note: 'Your ChatGPT subscription, no API key', group: 'cli', model: '', presets: [],
    install: 'npm i -g @openai/codex', installUrl: 'https://github.com/openai/codex', login: 'codex login', vision: true,
  },
  {
    id: 'gemini-cli', name: 'Gemini CLI', note: 'Your Google account, no API key', group: 'cli', model: '', presets: [],
    install: 'npm i -g @google/gemini-cli', installUrl: 'https://github.com/google-gemini/gemini-cli', vision: true,
  },
  {
    id: 'opencode', name: 'OpenCode', note: 'Free models out of the box, or any account you add', group: 'cli', model: '', presets: [],
    install: 'curl -fsSL https://opencode.ai/install | bash', installUrl: 'https://opencode.ai/docs', login: 'opencode auth login',
  },
  {
    id: 'antigravity', name: 'Antigravity', note: 'Your Google Antigravity sign-in, no API key', group: 'cli', model: '', presets: [],
    installUrl: 'https://antigravity.google',
  },
  {
    id: 'gemini', name: 'Google Gemini', note: 'Has a free tier', group: 'cloud', model: 'gemini-flash-latest',
    presets: [{ id: 'gemini-flash-latest', label: 'Flash' }, { id: 'gemini-pro-latest', label: 'Pro' }],
    keyUrl: 'https://aistudio.google.com/app/apikey', keyHint: 'AIza…', web: true, vision: true,
  },
  {
    id: 'openai', name: 'OpenAI', note: 'GPT models', group: 'cloud', model: 'gpt-5',
    presets: [{ id: 'gpt-5', label: 'GPT-5' }, { id: 'gpt-5-mini', label: 'GPT-5 mini' }],
    keyUrl: 'https://platform.openai.com/api-keys', keyHint: 'sk-…', web: true, vision: true,
  },
  {
    id: 'anthropic', name: 'Anthropic', note: 'Claude models by API key', group: 'cloud', model: 'claude-opus-5-5',
    presets: [{ id: 'claude-opus-5-5', label: 'Opus 5.5' }, { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' }, { id: 'claude-haiku-5-5', label: 'Haiku 5.5' }],
    keyUrl: 'https://platform.claude.com/settings/keys', keyHint: 'sk-ant-…', web: true, vision: true,
  },
  {
    id: 'openrouter', name: 'OpenRouter', note: 'One key for hundreds of models', group: 'cloud', model: 'openrouter/auto',
    presets: [{ id: 'openrouter/auto', label: 'Auto' }], keyUrl: 'https://openrouter.ai/settings/keys', keyHint: 'sk-or-…', web: true, vision: true,
  },
  {
    id: 'groq', name: 'Groq', note: 'Very fast open models', group: 'cloud', model: 'openai/gpt-oss-120b', presets: [],
    keyUrl: 'https://console.groq.com/keys', keyHint: 'gsk_…',
  },
  {
    id: 'deepseek', name: 'DeepSeek', note: 'Low-cost coding models', group: 'cloud', model: 'deepseek-chat', presets: [],
    keyUrl: 'https://platform.deepseek.com/api_keys', keyHint: 'sk-…',
  },
  {
    id: 'mistral', name: 'Mistral', note: 'European models', group: 'cloud', model: 'mistral-large-latest', presets: [],
    keyUrl: 'https://console.mistral.ai/api-keys',
  },
  {
    id: 'xai', name: 'xAI', note: 'Grok models', group: 'cloud', model: 'grok-4', presets: [],
    keyUrl: 'https://console.x.ai', keyHint: 'xai-…', vision: true,
  },
  {
    id: 'ollama', name: 'Ollama', note: 'Models on this computer', group: 'local', model: 'qwen2.5-coder:7b', presets: [],
    baseUrl: 'http://127.0.0.1:11434', installUrl: 'https://ollama.com/download', web: true,
  },
  {
    id: 'lmstudio', name: 'LM Studio', note: 'Models on this computer', group: 'local', model: '', presets: [],
    baseUrl: 'http://127.0.0.1:1234/v1', installUrl: 'https://lmstudio.ai',
  },
  {
    id: 'custom', name: 'Custom endpoint', note: 'Any OpenAI-compatible server', group: 'local', model: '', presets: [],
    keyHint: 'Optional', baseUrl: '', web: true,
  },
];

export const GROUPS: { id: ProviderGroup; title: string; note: string }[] = [
  { id: 'cli', title: 'Sign in once, no API key', note: 'Uses an agent CLI on this computer and your own subscription.' },
  { id: 'cloud', title: 'API key', note: 'Paste a key. It stays on this device.' },
  { id: 'local', title: 'Local and custom', note: 'Runs on your own hardware or endpoint.' },
];

/** The order a fresh install tries when it picks a provider for the user. */
export const FIRST_CHOICE: ProviderId[] = ['claude-code', 'codex', 'gemini-cli', 'opencode', 'antigravity', 'ollama', 'lmstudio'];

export function provider(id: string) {
  return PROVIDERS.find(item => item.id === id) ?? PROVIDERS[5];
}

export function available(desktop: boolean) {
  return desktop ? PROVIDERS : PROVIDERS.filter(item => item.web);
}
