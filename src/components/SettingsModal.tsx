import { useEffect, useRef, useState } from 'react';
import { X, BookOpen, FolderOpen, TerminalSquare, ShieldCheck, Moon, Sun, Circle, CheckCircle2, Cpu, KeyRound } from 'lucide-react';
import type { Config, Theme } from '../hooks/useTauriCommands';

type Props = {
  config: Config;
  defaultOutput: string;
  nativeAvailable: boolean;
  onSave: (config: Config) => Promise<void>;
  onClose: () => void;
  onSync: () => Promise<void>;
  onChooseOutput: (current: string) => Promise<string | null>;
  onDetectCodex: (config: Config) => Promise<string>;
};

const themes: { id: Theme; title: string; note: string; icon: typeof Moon }[] = [
  { id: 'dark', title: 'Dark', note: 'Graphite workspace', icon: Moon },
  { id: 'light', title: 'Light', note: 'Bright studio', icon: Sun },
  { id: 'amoled', title: 'AMOLED', note: 'Pure black', icon: Circle },
];

export default function SettingsModal(p: Props) {
  const [draft, setDraft] = useState(p.config);
  const [pending, setPending] = useState(false);
  const [codexStatus, setCodexStatus] = useState<{ ok: boolean; text: string }>();
  const dialog = useRef<HTMLElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const root = dialog.current;
    root?.querySelector<HTMLElement>('button')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pending) p.onClose();
      if (event.key !== 'Tab' || !root) return;
      const elements = [...root.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)')];
      const first = elements[0], last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); previous?.focus(); };
  }, [pending, p.onClose]);

  async function act(task: () => Promise<void>) { setPending(true); try { await task(); } finally { setPending(false); } }
  async function chooseOutput() {
    const selected = await p.onChooseOutput(draft.output_dir || p.defaultOutput);
    if (selected) setDraft(current => ({ ...current, output_dir: selected }));
  }
  async function checkCodex() {
    try { setCodexStatus({ ok: true, text: `Connected · ${await p.onDetectCodex(draft)}` }); }
    catch (error) { setCodexStatus({ ok: false, text: String(error) }); }
  }

  return <div className="modal-backdrop settings-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !pending) p.onClose(); }}>
    <section ref={dialog} role="dialog" aria-modal="true" aria-labelledby="settings-title" className="modal settings-modal">
      <div className="settings-hero">
        <div><span className="settings-kicker">WORKSPACE / CONFIGURATION</span><h2 id="settings-title">Settings</h2><p>Configure the studio, local tools, and optional cloud providers.</p></div>
        <button className="icon-button" disabled={pending} title="Close settings" onClick={p.onClose}><X size={18} /></button>
      </div>
      <div className="settings-scroll">
        {!p.nativeAvailable && (
          <div className="browser-settings-note">
            <ShieldCheck size={16} />
            <span>
              Web Studio runs OpenSCAD WebAssembly locally in this browser tab. Add your free Google Gemini key or OpenAI key below to enable AI model generation directly in your browser!
            </span>
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
        </section>
        <section className="settings-section codex-section" aria-disabled={!p.nativeAvailable}>
          <div className="settings-section-title"><TerminalSquare size={16} /><div><h3>Codex CLI · no API key</h3><p>Use your existing local Codex sign-in directly. Prompts run through the installed CLI.</p></div><span className="local-badge">LOCAL LOGIN</span></div>
          <label className="settings-field"><span>Codex executable</span><div className="path-row"><input disabled={pending || !p.nativeAvailable} value={draft.codex_path} placeholder="Auto-detect installed Codex CLI" onChange={e => { setDraft({ ...draft, codex_path: e.target.value }); setCodexStatus(undefined); }} /><button type="button" disabled={pending || !p.nativeAvailable} onClick={() => void act(checkCodex)}><Cpu size={15} />Check connection</button></div></label>
          {codexStatus && <div className={`connection-result ${codexStatus.ok ? 'success' : 'failure'}`}>{codexStatus.ok ? <CheckCircle2 size={15} /> : <X size={15} />}<span>{codexStatus.text}</span></div>}
          <p className="settings-hint">First-time setup: install the Codex CLI, run <code>codex login</code> in a terminal, then choose <b>Codex</b> as the provider. No provider API key is stored by this app.</p>
        </section>
        <details className="settings-section cloud-section" open={!p.nativeAvailable || Boolean(draft.gemini_key || draft.openai_key)}>
          <summary>
            <div className="settings-section-title">
              <KeyRound size={16} />
              <div>
                <h3>AI Cloud Providers {p.nativeAvailable ? '(Optional)' : '(Browser AI Generation)'}</h3>
                <p>
                  {p.nativeAvailable
                    ? 'Gemini and OpenAI keys are only needed when those providers are selected.'
                    : 'Enter your API key to generate 3D models with AI directly in this browser.'}
                </p>
              </div>
            </div>
          </summary>
          <div className="settings-grid two cloud-fields">
            <label className="settings-field">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <span>Gemini API key</span>
                <a
                  href="https://aistudio.google.com/app/apikey"
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: '10px', color: 'var(--accent)', textDecoration: 'underline', fontWeight: 600 }}
                >
                  Get free key (Google AI Studio) ↗
                </a>
              </div>
              <input
                disabled={pending}
                autoComplete="off"
                type="password"
                value={draft.gemini_key}
                placeholder="AIzaSy..."
                onChange={e => setDraft({ ...draft, gemini_key: e.target.value })}
              />
            </label>
            <label className="settings-field">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <span>OpenAI API key</span>
                <a
                  href="https://platform.openai.com/api-keys"
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: '10px', color: 'var(--accent)', textDecoration: 'underline', fontWeight: 600 }}
                >
                  Get OpenAI key ↗
                </a>
              </div>
              <input
                disabled={pending}
                autoComplete="off"
                type="password"
                value={draft.openai_key}
                placeholder="sk-..."
                onChange={e => setDraft({ ...draft, openai_key: e.target.value })}
              />
            </label>
          </div>
          <div className="privacy-note">
            <ShieldCheck size={16} />
            <span>
              {p.nativeAvailable
                ? 'Keys are written only to your local application data directory. They are never included in Git.'
                : 'Keys entered in browser mode are stored securely in your browser (localStorage) and sent directly to Google or OpenAI. They are never sent to any server.'}
            </span>
          </div>
        </details>
      </div>
      <div className="settings-footer"><button disabled={pending || !p.nativeAvailable} onClick={() => void act(p.onSync)}><BookOpen size={16} />Refresh documentation</button><div><button disabled={pending} onClick={p.onClose}>Cancel</button><button disabled={pending} className="primary" onClick={() => void act(() => p.onSave(draft))}>{pending ? 'Saving…' : 'Save changes'}</button></div></div>
    </section>
  </div>;
}
