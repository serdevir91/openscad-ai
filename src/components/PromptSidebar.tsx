import { Sparkles, ImagePlus, X, BookOpen, Square, BookCheck } from 'lucide-react';
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
  onAnalyze: () => void;
  onCancel: () => void;
  onModels: () => void;
  onOpenSkills: () => void;
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
        disabled={p.busy || p.webMode}
        onChange={e => {
          const provider = e.target.value as Provider;
          p.onConfig({ ...p.config, provider, model: defaultModels[provider] });
        }}
      >
        {Object.keys(defaultModels).map(provider => (
          <option key={provider}>{provider}</option>
        ))}
      </select>

      {/* Modern Model Selector */}
      <ModelSelector
        provider={p.config.provider}
        currentModel={p.config.model}
        fetchedModels={p.models}
        loadingModels={p.loadingModels}
        disabled={p.busy || p.webMode}
        onChangeModel={m => p.onConfig({ ...p.config, model: m })}
        onRefreshModels={p.onModels}
      />

      <button
        className="primary generate"
        disabled={p.busy || !p.ready || (!p.webMode && (!p.prompt.trim() || !p.config.model.trim()))}
        onClick={p.onGenerate}
      >
        <Sparkles size={17} />
        {p.busy ? 'Working…' : p.webMode ? 'Compile with OpenSCAD' : 'Generate design'}
        <span>↗</span>
      </button>

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
