import { useRef, useState } from 'react';
import { X, BookOpen, FolderOpen, Moon, Sun, Circle, CheckCircle2, Download, Star, ShieldCheck } from 'lucide-react';
import { useDialog } from '../hooks/useDialog';
import type { Config, Theme } from '../hooks/useTauriCommands';

type Props = {
  config: Config;
  defaultOutput: string;
  nativeAvailable: boolean;
  version: string;
  onSave: (config: Config) => Promise<void>;
  onClose: () => void;
  onSync: () => Promise<void>;
  onChooseOutput: (current: string) => Promise<string | null>;
  onCheckUpdates: () => Promise<string>;
  onRate: () => void;
};

const themes: { id: Theme; title: string; note: string; icon: typeof Moon }[] = [
  { id: 'dark', title: 'Dark', note: 'Graphite workspace', icon: Moon },
  { id: 'light', title: 'Light', note: 'Bright studio', icon: Sun },
  { id: 'amoled', title: 'AMOLED', note: 'Pure black', icon: Circle },
];

export default function SettingsModal(p: Props) {
  const [draft, setDraft] = useState(p.config);
  const [pending, setPending] = useState(false);
  const [update, setUpdate] = useState('');
  const dialog = useRef<HTMLElement>(null);
  useDialog(dialog, p.onClose, pending);

  async function act(task: () => Promise<void>) { setPending(true); try { await task(); } finally { setPending(false); } }
  async function chooseOutput() {
    const selected = await p.onChooseOutput(draft.output_dir || p.defaultOutput);
    if (selected) setDraft(current => ({ ...current, output_dir: selected }));
  }

  return <div className="modal-backdrop settings-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !pending) p.onClose(); }}>
    <section ref={dialog} role="dialog" aria-modal="true" aria-labelledby="settings-title" className="modal settings-modal">
      <div className="settings-hero">
        <div><span className="settings-kicker">WORKSPACE / CONFIGURATION</span><h2 id="settings-title">Settings</h2><p>Configure the studio and its local tools. AI providers live under Connections.</p></div>
        <button className="icon-button" disabled={pending} title="Close settings" onClick={p.onClose}><X size={18} /></button>
      </div>
      <div className="settings-scroll">
        {!p.nativeAvailable && (
          <div className="browser-settings-note">
            <ShieldCheck size={16} />
            <span>Web Studio runs OpenSCAD and the STEP converter in this browser tab. Nothing is uploaded.</span>
          </div>
        )}
        <section className="settings-section">
          <div className="settings-section-title"><Sun size={16} /><div><h3>Appearance</h3><p>Choose the canvas that feels best for long CAD sessions.</p></div></div>
          <div className="theme-grid">
            {themes.map(option => { const Icon = option.icon; return <button key={option.id} type="button" className={`theme-card ${draft.theme === option.id ? 'selected' : ''}`} onClick={() => setDraft({ ...draft, theme: option.id })} disabled={pending}>
              <span className={`theme-swatch ${option.id}`}><Icon size={17} /></span><span><b>{option.title}</b><small>{option.note}</small></span>{draft.theme === option.id && <CheckCircle2 size={16} className="theme-check" />}
            </button>; })}
          </div>
        </section>
        <section className="settings-section" aria-disabled={!p.nativeAvailable}>
          <div className="settings-section-title"><FolderOpen size={16} /><div><h3>Files & rendering</h3><p>Models are saved here after every successful compile.</p></div></div>
          <label className="settings-field"><span>Output folder</span><div className="path-row"><input readOnly disabled={!p.nativeAvailable} value={draft.output_dir || p.defaultOutput} placeholder={p.nativeAvailable ? 'Application data / outputs' : 'Browser downloads'} /><button type="button" disabled={pending || !p.nativeAvailable} onClick={() => void chooseOutput()}><FolderOpen size={15} />Browse</button></div></label>
          <button type="button" className="text-button" disabled={pending || !draft.output_dir || !p.nativeAvailable} onClick={() => setDraft({ ...draft, output_dir: '' })}>Restore application default</button>
          <div className="settings-grid two">
            <label className="settings-field"><span>OpenSCAD executable</span><input disabled={pending || !p.nativeAvailable} value={draft.openscad_path} placeholder={p.nativeAvailable ? 'Auto-detect' : 'Built-in WebAssembly'} onChange={e => setDraft({ ...draft, openscad_path: e.target.value })} /></label>
            <label className="settings-field"><span>Auto-repair attempts</span><input disabled={pending} type="number" min="0" max="5" value={draft.max_repairs} onChange={e => setDraft({ ...draft, max_repairs: Math.max(0, Math.min(5, Number(e.target.value))) })} /></label>
          </div>
          <div className="settings-grid two">
            <label className="settings-field"><span>Compile time limit, seconds</span><input disabled={pending} type="number" min="10" max="1800" value={draft.render_timeout} onChange={e => setDraft({ ...draft, render_timeout: Math.max(10, Math.min(1800, Number(e.target.value))) })} /></label>
          </div>
        </section>
        <section className="settings-section">
          <div className="settings-section-title"><Download size={16} /><div><h3>About</h3><p>OpenSCAD AI {p.version} is free software under the GPL.</p></div></div>
          <div className="provider-actions">
            {p.nativeAvailable && <button type="button" disabled={pending} onClick={() => void act(async () => setUpdate(await p.onCheckUpdates()))}><Download size={15} />Check for updates</button>}
            <button type="button" onClick={p.onRate}><Star size={15} />Rate on GitHub</button>
          </div>
          {update && <p className="settings-hint">{update}</p>}
        </section>
      </div>
      <div className="settings-footer"><button disabled={pending || !p.nativeAvailable} onClick={() => void act(p.onSync)}><BookOpen size={16} />Refresh documentation</button><div><button disabled={pending} onClick={p.onClose}>Cancel</button><button disabled={pending} className="primary" onClick={() => void act(() => p.onSave(draft))}>{pending ? 'Saving…' : 'Save changes'}</button></div></div>
    </section>
  </div>;
}
