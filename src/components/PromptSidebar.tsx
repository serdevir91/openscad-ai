import { Sparkles, ImagePlus, X, BookOpen, Square, BookCheck, Plug, Play } from 'lucide-react';
import type { Config, ProviderStatus, ReferenceImage } from '../hooks/useTauriCommands';
import { available, provider as providerInfo } from '../ai/providers';
import { selectProvider } from './ConnectionsModal';
import ModelSelector from './ModelSelector';

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
  status: Record<string, ProviderStatus>;
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
  onOpenConnections: () => void;
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

      <div className="field-row">
        <label className="field-label" htmlFor="provider">AI PROVIDER</label>
        <button type="button" className="link-button" onClick={p.onOpenConnections}><Plug size={11} />Connections</button>
      </div>
      <select
        id="provider"
        value={p.config.provider}
        disabled={p.busy}
        onChange={e => p.onConfig(selectProvider(p.config, providerInfo(e.target.value)))}
      >
        {available(!p.webMode).map(item => (
          <option key={item.id} value={item.id}>{(p.status[item.id]?.ready || p.config.keys[item.id]?.trim() ? '● ' : '○ ') + item.name}</option>
        ))}
      </select>

      {/* Modern Model Selector */}
      <ModelSelector
        provider={p.config.provider}
        currentModel={p.config.model}
        fetchedModels={p.models}
        loadingModels={p.loadingModels}
        disabled={p.busy}
        onChangeModel={m => p.onConfig({ ...p.config, model: m, models: { ...p.config.models, [p.config.provider]: m } })}
        onRefreshModels={p.onModels}
      />

      <div className="mode-switch" role="radiogroup" aria-label="Generation mode">
        {(['precise', 'fast'] as const).map(mode => (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={p.config.mode === mode}
            className={p.config.mode === mode ? 'selected' : ''}
            disabled={p.busy}
            title={mode === 'precise' ? 'Plans the dimensions, measures the result, and repairs until it matches' : 'One pass that only repairs compile errors'}
            onClick={() => p.onConfig({ ...p.config, mode })}
          >
            {mode === 'precise' ? 'Precise' : 'Fast'}
          </button>
        ))}
      </div>

      {p.status[p.config.provider] && !p.status[p.config.provider].ready && !p.config.keys[p.config.provider]?.trim() && (
        <button type="button" className="setup-notice" onClick={p.onOpenConnections}>
          <Plug size={13} />
          <span>Set up {providerInfo(p.config.provider).name} to generate designs</span>
        </button>
      )}

      <button
        className="primary generate"
        disabled={p.busy || !p.ready || !p.prompt.trim()}
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
          {p.config.mode === 'precise' ? <>Plan, measure, repair<br /><b>Checked against your dimensions</b></> : <>One pass<br /><b>Repairs compile errors only</b></>}
        </p>
      </div>
      {providerInfo(p.config.provider).group === 'cli' && <div className="codex-inline-note"><span>●</span>Uses your {providerInfo(p.config.provider).name} sign-in · no API key</div>}
      <div className="sidebar-foot">NATURAL LANGUAGE · REAL GEOMETRY</div>
    </aside>
  );
}
