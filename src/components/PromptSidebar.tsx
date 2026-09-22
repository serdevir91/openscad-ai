import { Sparkles, ImagePlus, X, BookOpen, Square, BookCheck, KeyRound, Play } from 'lucide-react';
import type { Config, Provider, ReferenceImage } from '../hooks/useTauriCommands';
import ModelSelector from './ModelSelector';

export const defaultModels: Record<Provider, string> = {
  gemini: 'gemini-2.5-flash',
  openai: 'gpt-4o',
  ollama: 'qwen2.5-coder:7b',
  codex: 'gpt-5.3-codex',
};

type Props = {
  config: Config;
  prompt: string;
  image?: ReferenceImage;
  models: string[];
  busy: boolean;
  ready: boolean;
  loadingModels: boolean;
  activeSkillsCount: number;
  webMode: boolean;
  onPrompt: (v: string) => void;
  onConfig: (v: Config) => void;
  onImage: (file?: File) => void;
  onClearImage: () => void;
  onGenerate: () => void;
  onCompileOnly?: () => void;
  onAnalyze: () => void;
  onCancel: () => void;
  onModels: () => void;
  onOpenSkills: () => void;
  onOpenSettings: () => void;
};

export default function PromptSidebar(p: Props) {
  return (
    <aside className="prompt-panel">
      <div className="section-title">
        <span>01 / DESIGN ASSISTANT</span>
        <Sparkles size={15} />
      </div>
      <h1>
        Shape your<br />
        <em>next idea.</em>
      </h1>
      <p className="intro">
        {p.webMode ? <>Edit, compile, explore.<br />OpenSCAD in your browser.</> : <>Describe, refine, manufacture.<br />AI for parametric design.</>}
      </p>

      <label className="field-label" htmlFor="prompt">WHAT SHOULD WE DESIGN?</label>
      <textarea
        id="prompt"
        disabled={p.busy}
        value={p.prompt}
        onChange={e => p.onPrompt(e.target.value)}
        placeholder="Example: An 80 mm phone stand with a cable channel and a 15° tilt…"
      />

      <label className="image-upload">
        <ImagePlus size={19} />
        <span>
          {p.image ? 'Reference image attached' : 'Attach reference image'}
          <small>PNG, JPEG, WEBP · 10 MB</small>
        </span>
        <input
          type="file"
          aria-label="Choose reference image"
          accept="image/png,image/jpeg,image/webp"
          disabled={p.busy}
          onChange={e => {
            p.onImage(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </label>

      {p.image && (
        <>
          <div className="reference">
            <img alt="Design reference" src={`data:${p.image.mime};base64,${p.image.data}`} />
            <button disabled={p.busy} title="Remove image" onClick={p.onClearImage}>
              <X size={14} />
            </button>
          </div>
          <button disabled={p.busy || !p.ready} onClick={p.onAnalyze}>
            Create brief from image
          </button>
        </>
      )}

      {/* Skills / Design Rules Button */}
      <div className="skills-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <BookCheck size={14} color="var(--accent)" />
          <span style={{ fontWeight: 600 }}>Design rules</span>
        </div>
        <button
          type="button"
          onClick={p.onOpenSkills}
          disabled={p.busy}
          style={{ padding: '3px 8px', fontSize: '10px', background: 'var(--panel)' }}
        >
          {p.activeSkillsCount > 0 ? `${p.activeSkillsCount} active` : 'Add rule'}
        </button>
      </div>

      <label className="field-label" htmlFor="provider">AI PROVIDER</label>
      <select
        id="provider"
        value={p.config.provider}
        disabled={p.busy}
        onChange={e => {
          const provider = e.target.value as Provider;
          p.onConfig({ ...p.config, provider, model: defaultModels[provider] });
        }}
      >
        {(p.webMode ? (['gemini', 'openai'] as Provider[]) : (Object.keys(defaultModels) as Provider[])).map(provider => (
          <option key={provider} value={provider}>{provider.toUpperCase()}</option>
        ))}
      </select>

      {/* Modern Model Selector */}
      <ModelSelector
        provider={p.config.provider}
        currentModel={p.config.model}
        fetchedModels={p.models}
        loadingModels={p.loadingModels}
        disabled={p.busy}
        onChangeModel={m => p.onConfig({ ...p.config, model: m })}
        onRefreshModels={p.onModels}
      />

      {p.webMode && (
        <div className="web-api-notice" style={{ margin: '12px 0 6px', padding: '10px 12px', background: 'var(--sub)', border: '1px solid var(--border)', borderRadius: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontWeight: 600, fontSize: '11px', color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: '5px' }}>
              <KeyRound size={13} />
              {p.config.provider === 'gemini'
                ? (p.config.gemini_key?.trim() ? 'Gemini Key Configured' : 'Google Gemini Key')
                : (p.config.openai_key?.trim() ? 'OpenAI Key Configured' : 'OpenAI Key')}
            </span>
            <button
              type="button"
              onClick={p.onOpenSettings}
              style={{ padding: '3px 8px', fontSize: '10px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: '4px', cursor: 'pointer' }}
            >
              {p.config.gemini_key?.trim() || p.config.openai_key?.trim() ? 'Change' : 'Add key'}
            </button>
          </div>
          {!(p.config.provider === 'gemini' ? p.config.gemini_key?.trim() : p.config.openai_key?.trim()) && (
            <div style={{ fontSize: '10px', color: 'var(--muted)', lineHeight: '1.45', marginTop: '5px' }}>
              <span>Enter your API key to generate models with AI in the browser.</span>
              <br />
              <a
                href={p.config.provider === 'gemini' ? 'https://aistudio.google.com/app/apikey' : 'https://platform.openai.com/api-keys'}
                target="_blank"
                rel="noreferrer"
                style={{ color: 'var(--accent)', textDecoration: 'underline', fontWeight: 600, display: 'inline-block', marginTop: '3px' }}
              >
                {p.config.provider === 'gemini' ? 'Get free Gemini key (Google AI Studio) ↗' : 'Get OpenAI API key ↗'}
              </a>
            </div>
          )}
        </div>
      )}

      <button
        className="primary generate"
        disabled={p.busy || !p.ready || (!p.prompt.trim() && !p.webMode)}
        onClick={p.onGenerate}
        title="Generate OpenSCAD model from natural language prompt"
      >
        <Sparkles size={17} />
        {p.busy ? 'Working…' : 'Generate design'}
        <span>↗</span>
      </button>

      {p.webMode && (
        <button
          type="button"
          disabled={p.busy}
          onClick={p.onCompileOnly}
          style={{
            marginTop: '8px',
            padding: '9px 12px',
            fontSize: '11px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            background: 'var(--sub)',
            border: '1px solid var(--border)',
            borderRadius: '6px',
            color: 'var(--text)',
            cursor: 'pointer'
          }}
          title="Compile editor code with OpenSCAD WebAssembly (no AI)"
        >
          <Play size={13} />
          <span>Compile with OpenSCAD WASM</span>
        </button>
      )}

      {p.busy && (
        <button className="cancel" onClick={p.onCancel}>
          <Square size={12} />
          Cancel operation
        </button>
      )}

      <div className="sidebar-note">
        <BookOpen size={16} />
        <p>
          {p.webMode ? <>Official OpenSCAD WebAssembly<br /><b>Runs locally in this tab</b></> : <>OpenSCAD documentation context<br /><b>Compile + automatic repair</b></>}
        </p>
      </div>
      {p.config.provider === 'codex' && <div className="codex-inline-note"><span>●</span>Uses your local Codex CLI login · no API key</div>}
      <div className="sidebar-foot">NATURAL LANGUAGE · REAL GEOMETRY</div>
    </aside>
  );
}
