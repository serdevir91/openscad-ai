import { useCallback, useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { Play, Download, X, FolderOpen, Code2, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import Header from './components/Header';
import PromptSidebar from './components/PromptSidebar';
import MonacoEditor from './components/MonacoEditor';
import Viewport3D from './components/Viewport3D';
import ParametricBar from './components/ParametricBar';
import LogConsole from './components/LogConsole';
import SettingsModal from './components/SettingsModal';
import SkillsModal from './components/SkillsModal';
import { useSkills } from './hooks/useSkills';
import { commands, defaults, desktop, type Config, type Artifact, type ReferenceImage, type SavedModel } from './hooks/useTauriCommands';
import { base64ToBytes, compileInBrowser, downloadBrowserFile } from './browserOpenScad';
import { generateInBrowser, analyzeImageInBrowser, fetchBrowserModels } from './browserAi';

const initial = `// Parametric desk tray · dimensions in mm
width = 90; // [30:1:180]
depth = 60; // [20:1:120]
height = 18; // [5:1:60]
wall = 3; // [1:0.5:8]

$fn = 64;
difference() {
  cube([width, depth, height], center=true);
  translate([0, 0, wall])
    cube([width-wall*2, depth-wall*2, height], center=true);
}
`;

const STORAGE_CONFIG_KEY = 'openscad-ai-config';
function storedCode() { try { return localStorage.getItem('scad-draft') ?? initial; } catch { return initial; } }
function storedConfig(): Config {
  if (desktop) return defaults;
  try {
    const raw = localStorage.getItem(STORAGE_CONFIG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...defaults, ...parsed };
    }
    const theme = localStorage.getItem('openscad-ai-theme');
    return theme === 'dark' || theme === 'light' || theme === 'amoled' ? { ...defaults, theme } : defaults;
  } catch { return defaults; }
}

export default function App() {
  const [config, setConfig] = useState<Config>(storedConfig);
  const [ready, setReady] = useState(!desktop);
  const [code, setCode] = useState(storedCode);
  const [prompt, setPrompt] = useState('');
  const [artifact, setArtifact] = useState<Artifact>();
  const [image, setImage] = useState<ReferenceImage>();
  const [busy, setBusy] = useState(false);
  const operation = useRef(false);
  const browserBooted = useRef(false);
  const [settings, setSettings] = useState(false);
  const [skillsModalOpen, setSkillsModalOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    try { return localStorage.getItem('sidebar-open') !== 'false'; } catch { return true; }
  });
  const [editorOpen, setEditorOpen] = useState(() => {
    try { return localStorage.getItem('editor-open') !== 'false'; } catch { return true; }
  });
  const { skills, activeSkills, activeSkillPrompts, toggleSkill, addSkill, deleteSkill } = useSkills();
  const [logs, setLogs] = useState<string[]>(['Workspace ready.']);
  const [status, setStatus] = useState(desktop ? 'Checking OpenSCAD' : 'OpenSCAD WASM ready');
  const [available, setAvailable] = useState(!desktop);
  const [error, setError] = useState('');
  const [output, setOutput] = useState('');
  const [saved, setSaved] = useState<SavedModel[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const dirty = artifact?.code !== code;
  const log = useCallback((s: string) => setLogs(a => [...a.slice(-199), s]), []);
  const fail = useCallback((e: unknown) => { setError(String(e)); log(String(e)); }, [log]);
  const closeSettings = useCallback(() => setSettings(false), []);

  useEffect(() => {
    try { localStorage.setItem('sidebar-open', String(sidebarOpen)); } catch {}
  }, [sidebarOpen]);

  useEffect(() => {
    try { localStorage.setItem('editor-open', String(editorOpen)); } catch {}
  }, [editorOpen]);

  useEffect(() => {
    if (!desktop) return;
    let active = true;
    commands.load().then(c => { if (active) { setConfig(c); setReady(true); } }).catch(fail);
    commands.detect().then(() => { if (active) { setStatus('OpenSCAD ready'); setAvailable(true); } }).catch(() => { if (active) setStatus('OpenSCAD not found'); });
    commands.outputs().then(p => { if (active) setOutput(p); }).catch(fail);
    commands.listOutputs().then(p => { if (active) setSaved(p); }).catch(fail);
    const subscription = listen<string>('pipeline-log', e => { if (active) log(e.payload); });
    return () => { active = false; void subscription.then(unlisten => unlisten()).catch(() => {}); };
  }, [fail, log]);

  useEffect(() => {
    if (desktop || browserBooted.current) return;
    browserBooted.current = true;
    void work('render');
  }, []);

  useEffect(() => { document.documentElement.dataset.theme = config.theme; }, [config.theme]);
  useEffect(() => { try { localStorage.setItem('scad-draft', code); } catch { /* Editing remains available if storage is full. */ } }, [code]);
  useEffect(() => { setModels([]); }, [config.provider]);

  async function run(task: () => Promise<void>) {
    if (operation.current) return;
    operation.current = true;
    setBusy(true); setError('');
    try { await task(); } catch (e) { fail(e); } finally { operation.current = false; setBusy(false); }
  }
  function updateConfig(c: Config) {
    setConfig(c);
    if (!desktop) {
      try {
        localStorage.setItem(STORAGE_CONFIG_KEY, JSON.stringify(c));
        localStorage.setItem('openscad-ai-theme', c.theme);
      } catch {}
    }
  }

  async function work(kind: 'generate' | 'render') {
    if (!desktop) {
      await run(async () => {
        if (kind === 'render') {
          log('Compiling with OpenSCAD WebAssembly…');
          const compiled = await compileInBrowser(code);
          setArtifact(compiled);
          setStatus('OpenSCAD WASM ready');
          log('browser-model.stl · ready');
          return;
        }

        if (!prompt.trim()) {
          throw new Error('Please enter a prompt describing the model you want to generate.');
        }

        const provider = config.provider || 'gemini';
        const hasKey = provider === 'gemini'
          ? Boolean(config.gemini_key?.trim())
          : Boolean(config.openai_key?.trim());

        if (!hasKey) {
          setSettings(true);
          const link = provider === 'gemini'
            ? 'https://aistudio.google.com/app/apikey'
            : 'https://platform.openai.com/api-keys';
          throw new Error(
            `Please add your ${provider === 'gemini' ? 'Google Gemini' : 'OpenAI'} API key in Settings to generate models with AI in the browser. Get key: ${link}`
          );
        }

        log(`Generating design with AI (${provider} · ${config.model || 'default'})…`);
        let currentCode = await generateInBrowser(config, prompt, code, image, activeSkillPrompts);
        log('Validating geometry with OpenSCAD WebAssembly…');
        let compiled: Artifact | null = null;
        let lastError = '';

        const maxRepairs = Math.max(0, Math.min(5, config.max_repairs ?? 2));
        for (let attempt = 0; attempt <= maxRepairs; attempt++) {
          try {
            compiled = await compileInBrowser(currentCode);
            break;
          } catch (e) {
            lastError = (e as Error).message || String(e);
            if (attempt === maxRepairs) {
              throw new Error(`Auto-repair limit reached: ${lastError}`);
            }
            log(`Automatic repair (attempt ${attempt + 1})…`);
            currentCode = await generateInBrowser(config, prompt, currentCode, image, activeSkillPrompts, lastError);
          }
        }

        if (compiled) {
          setArtifact(compiled);
          setCode(compiled.code);
          setStatus('OpenSCAD WASM ready');
          log('Geometry validated · OpenSCAD model ready');
        }
      });
      return;
    }
    await run(async () => {
      await commands.save(config);
      log(kind === 'generate' ? 'Generating design…' : 'Compiling geometry…');
      const a = kind === 'generate'
        ? await commands.generate(prompt, code, image, activeSkillPrompts)
        : await commands.render(code);
      setArtifact(a); setCode(a.code); log(`${a.name} · ready`);
      setSaved(await commands.listOutputs());
    });
  }
  async function saveSettings(c: Config) {
    if (!desktop) {
      updateConfig(c);
      setSettings(false);
      log('Settings saved.');
      return;
    }
    try {
      await commands.save(c); setConfig(c); setSettings(false);
      const found = await commands.detect().then(() => true).catch(() => false);
      setAvailable(found); setStatus(found ? 'OpenSCAD ready' : 'OpenSCAD not found');
      setOutput(await commands.outputs());
      setSaved(await commands.listOutputs());
    } catch (e) { fail(e); }
  }
  async function selectImage(file?: File) {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { fail('Use a PNG, JPEG, or WebP image up to 10 MB'); return; }
    const reader = new FileReader();
    reader.onload = () => setImage({ mime: file.type, data: String(reader.result).split(',')[1] });
    reader.onerror = () => fail('The image could not be read');
    reader.readAsDataURL(file);
  }
  async function refreshModels() {
    setLoadingModels(true);
    try {
      const names = desktop ? await commands.models(config) : await fetchBrowserModels(config);
      setModels(names);
      log(`${names.length} models found for ${config.provider}. Choose one from the model field.`);
    } catch (e) {
      fail(e);
    } finally {
      setLoadingModels(false);
    }
  }
  function changeTheme() {
    const theme = config.theme === 'dark' ? 'amoled' : config.theme === 'amoled' ? 'light' : 'dark';
    const c: Config = { ...config, theme }; setConfig(c);
    if (desktop && ready) void commands.save(c).catch(fail);
    else try { localStorage.setItem('openscad-ai-theme', theme); } catch {}
  }
  async function exportFile(format: 'scad' | 'stl' | 'png') {
    if (!desktop) {
      await run(async () => {
        if (format === 'scad') {
          downloadBrowserFile('browser-model.scad', code, 'text/plain;charset=utf-8');
          log('Downloaded: browser-model.scad');
          return;
        }
        if (format === 'png') throw new Error('PNG export is available in the desktop app.');
        let current = artifact;
        if (!current || current.code !== code) {
          log('Compiling STL with OpenSCAD WebAssembly…');
          current = await compileInBrowser(code);
          setArtifact(current);
        }
        downloadBrowserFile('browser-model.stl', base64ToBytes(current.stl), 'model/stl');
        log('Downloaded: browser-model.stl');
      });
      return;
    }
    await run(async () => {
      await commands.save(config);
      const path = await commands.export(code, format);
      if (path) log(`Saved: ${path}`);
    });
  }
  async function openFile(file?: File) {
    if (!file) return;
    if (file.size > 1_000_000) { fail('SCAD files cannot exceed 1 MB'); return; }
    try { setCode(await file.text()); setArtifact(undefined); } catch (e) { fail(e); }
  }

  return (
    <div className="app">
      <Header
        theme={config.theme}
        status={status}
        available={available}
        disabled={busy || (desktop && !ready)}
        sidebarOpen={sidebarOpen}
        activeSkillsCount={activeSkills.length}
        onTheme={changeTheme}
        onSettings={() => setSettings(true)}
        onToggleSidebar={() => setSidebarOpen(s => !s)}
        onOpenSkills={() => setSkillsModalOpen(true)}
      />
      {!desktop && (
        <div className="web-banner">
          <span><b>LIVE WEB STUDIO</b> · Real OpenSCAD WebAssembly runs in your browser. Add your free Gemini API key to generate models with AI!</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', fontWeight: 600, textDecoration: 'underline' }}>
              Get Free Gemini Key ↗
            </a>
            <button
              type="button"
              onClick={() => setSettings(true)}
              style={{ padding: '3px 8px', fontSize: '11px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: '4px', cursor: 'pointer' }}
            >
              Configure Key
            </button>
          </div>
        </div>
      )}
      <main>
        {sidebarOpen && (
          <PromptSidebar
            config={config}
            prompt={prompt}
            image={image}
            models={models}
            loadingModels={loadingModels}
            ready={ready}
            busy={busy}
            activeSkillsCount={activeSkills.length}
            webMode={!desktop}
            onPrompt={setPrompt}
            onConfig={updateConfig}
            onImage={file => void selectImage(file)}
            onClearImage={() => setImage(undefined)}
            onGenerate={() => void work('generate')}
            onCompileOnly={() => void work('render')}
            onOpenSettings={() => setSettings(true)}
            onModels={() => void refreshModels()}
            onCancel={() => void commands.cancel().catch(fail)}
            onOpenSkills={() => setSkillsModalOpen(true)}
            onAnalyze={() => {
              if (image) void run(async () => {
                log('Analyzing reference image…');
                const brief = desktop
                  ? await commands.analyze(config, image)
                  : await analyzeImageInBrowser(config, image);
                setPrompt(brief);
                log('Design brief ready.');
              });
            }}
          />
        )}
        <section className="workspace">
          <div className="workspace-toolbar">
            <div>
              <span className="file-dot" />
              <span className="filename">{artifact ? `${artifact.name}.scad` : 'untitled.scad'}</span>
              <small>{artifact ? dirty ? 'Edited' : 'Validated' : 'Draft'}</small>
            </div>
            <div>
              <button
                type="button"
                className="editor-toggle"
                aria-pressed={editorOpen}
                title={editorOpen ? 'Hide code editor' : 'Show code editor'}
                onClick={() => setEditorOpen(open => !open)}
              >
                {editorOpen ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
                <Code2 size={14} />
                {editorOpen ? 'Hide code' : 'Show code'}
              </button>
              <select aria-label="Saved designs" className="saved-select" disabled={busy || !saved.length} value="" onChange={e => { const name = e.target.value; if (name) void commands.readOutput(name).then(text => { setCode(text); setArtifact(undefined); log(`${name} opened`); }).catch(fail); }}>
                <option value="">Saved designs</option>
                {saved.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
              </select>
              <label className="button">
                <FolderOpen size={15} />
                Open
                <input type="file" aria-label="Open SCAD file" accept=".scad" disabled={busy} onChange={e => { void openFile(e.target.files?.[0]); e.target.value = ''; }} />
              </label>
              {busy && (
                <button
                  type="button"
                  style={{ color: '#f87171', borderColor: '#f87171', padding: '5px 9px' }}
                  title="Cancel the running operation"
                  onClick={() => {
                    void commands.cancel().then(() => {
                      setBusy(false);
                      operation.current = false;
                      log('Operation cancelled by the user.');
                    }).catch(fail);
                  }}
                >
                  Stop
                </button>
              )}
              <button disabled={busy || !ready} className="compile" onClick={() => void work('render')}>
                <Play size={14} />
                {busy ? 'Working…' : 'Compile'}
              </button>
            </div>
          </div>
          <div className={`edit-view ${editorOpen ? '' : 'editor-collapsed'}`}>
            {editorOpen && <div className="editor-panel">
              <div className="panel-caption">
                <span className="caption-label">02 / CODE EDITOR</span>
                <span className="caption-actions">OPENSCAD · CTRL+ENTER TO COMPILE <button type="button" title="Hide code editor" onClick={() => setEditorOpen(false)}><PanelLeftClose size={13} /></button></span>
              </div>
              <div className="editor">
                <MonacoEditor code={code} onChange={setCode} theme={config.theme} disabled={busy} onRun={() => void work('render')} />
              </div>
            </div>}
            <div className="preview-panel">
              <div className="panel-caption">
                <span className="caption-label">03 / LIVE GEOMETRY</span>
                <span className="caption-actions">{!editorOpen && <button type="button" title="Show code editor" onClick={() => setEditorOpen(true)}><PanelLeftOpen size={13} /></button>}{artifact && dirty ? 'PREVIOUS COMPILE' : 'STL VIEWPORT'}</span>
              </div>
              <Viewport3D stl={artifact?.stl} theme={config.theme} />
              <div className="export-bar">
                <span>{artifact ? dirty ? '○ Code changed' : '● Geometry ready' : '○ Waiting for compile'}</span>
                <button disabled={busy || !ready} onClick={() => void exportFile('scad')}><Download size={14} />SCAD</button>
                <button disabled={busy || !ready} onClick={() => void exportFile('stl')}>STL ↗</button>
                <button disabled={busy || !ready || !desktop} title={desktop ? 'Export PNG' : 'PNG export requires the desktop app'} onClick={() => void exportFile('png')}>PNG ↗</button>
              </div>
            </div>
          </div>
          <ParametricBar code={code} disabled={busy} onChange={setCode} />
          <LogConsole logs={logs} busy={busy} />
        </section>
      </main>
      {error && <div className="error-banner" role="alert">{error}<button title="Dismiss error" onClick={() => setError('')}><X size={16} /></button></div>}
      <footer>
        <span>OPENSCAD AI <b>v0.2</b></span>
        <span>{desktop ? 'RUST CORE' : 'OPENSCAD WASM'} · THREE.JS · MONACO</span>
        <span>{busy ? 'Operation in progress' : 'Workspace ready'}</span>
      </footer>
      {settings && <SettingsModal config={config} defaultOutput={output} nativeAvailable={desktop} onClose={closeSettings} onSave={saveSettings}
        onChooseOutput={desktop ? commands.chooseOutput : async () => null} onDetectCodex={commands.detectCodex}
        onSync={async () => { if (!desktop) return; try { log(`${await commands.sync()} documentation sources cached`); } catch (e) { fail(e); } }} />}
      {skillsModalOpen && (
        <SkillsModal
          skills={skills}
          onClose={() => setSkillsModalOpen(false)}
          onToggle={toggleSkill}
          onAdd={addSkill}
          onDelete={deleteSkill}
        />
      )}
    </div>
  );
}
