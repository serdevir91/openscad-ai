import { useCallback, useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { Play, Download, X, FolderOpen, Code2, PanelLeftClose, PanelLeftOpen, Square } from 'lucide-react';
import Header from './components/Header';
import PromptSidebar from './components/PromptSidebar';
import MonacoEditor from './components/MonacoEditor';
import Viewport3D from './components/Viewport3D';
import ParametricBar from './components/ParametricBar';
import LogConsole from './components/LogConsole';
import SettingsModal from './components/SettingsModal';
import SkillsModal from './components/SkillsModal';
import ConnectionsModal, { selectProvider } from './components/ConnectionsModal';
import VerificationPanel from './components/VerificationPanel';
import { useSkills } from './hooks/useSkills';
import { commands, defaults, desktop, type Config, type ProviderStatus, type ReferenceImage, type SavedModel } from './hooks/useTauriCommands';
import { design, imageBrief, measured, type Design, type Tools } from './ai/pipeline';
import { FIRST_CHOICE, provider as providerInfo } from './ai/providers';
import { compile, complete, docs, isNewer, listModels, nativeFound, openLink, saveDesign, saveFile, statuses } from './ai/transport';
import { diagnostics, type Diagnostic } from './cad/diagnostics';
import { buildStep } from './cad/stepClient';
import { stlTo3mf } from './cad/threeMf';
import { renderPng, renderViews } from './cad/views';
import { version } from '../package.json';

const REPOSITORY = 'https://github.com/serdevir91/openscad-ai';
const RATE_AFTER = 3;

const initial = `// Parametric desk tray · dimensions in mm
width = 90; // [30:1:180]
depth = 60; // [20:1:120]
height = 18; // [5:1:60]
wall = 3; // [1:0.5:8]

$fn = 64;
difference() {
  translate([-width/2, -depth/2, 0])
    cube([width, depth, height]);
  translate([-width/2+wall, -depth/2+wall, wall])
    cube([width-wall*2, depth-wall*2, height]);
}
`;

const STORAGE_CONFIG_KEY = 'openscad-ai-config';
function storedCode() { try { return localStorage.getItem('scad-draft') ?? initial; } catch { return initial; } }
function storedConfig(): Config {
  if (desktop) return defaults;
  try {
    const raw = localStorage.getItem(STORAGE_CONFIG_KEY);
    if (raw) {
      const { gemini_key, openai_key, ...parsed } = JSON.parse(raw);
      const keys = { ...(gemini_key ? { gemini: gemini_key } : {}), ...(openai_key ? { openai: openai_key } : {}), ...parsed.keys };
      return { ...defaults, ...parsed, keys };
    }
    const theme = localStorage.getItem('openscad-ai-theme');
    return theme === 'dark' || theme === 'light' || theme === 'amoled' ? { ...defaults, theme } : defaults;
  } catch { return defaults; }
}
const message = (e: unknown) => e instanceof Error ? e.message : String(e);
const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

export default function App() {
  const [config, setConfig] = useState<Config>(storedConfig);
  const [ready, setReady] = useState(!desktop);
  const [code, setCode] = useState(storedCode);
  const [prompt, setPrompt] = useState('');
  const [artifact, setArtifact] = useState<Design>();
  const [name, setName] = useState('model');
  const [image, setImage] = useState<ReferenceImage>();
  const [busy, setBusy] = useState(false);
  const operation = useRef(false);
  const abort = useRef<AbortController>(undefined);
  const booted = useRef(false);
  const [settings, setSettings] = useState(false);
  const [connections, setConnections] = useState(false);
  const [providers, setProviders] = useState<Record<string, ProviderStatus>>({});
  const [issues, setIssues] = useState<Diagnostic[]>([]);
  const [notice, setNotice] = useState<{ text: string; action: string; url: string }>();
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
  const [error, setError] = useState('');
  const [output, setOutput] = useState('');
  const [saved, setSaved] = useState<SavedModel[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const dirty = artifact?.code !== code;
  const log = useCallback((s: string) => setLogs(a => [...a.slice(-199), s]), []);
  const fail = useCallback((e: unknown) => { setError(message(e)); log(message(e)); }, [log]);
  const closeSettings = useCallback(() => setSettings(false), []);
  const closeConnections = useCallback(() => setConnections(false), []);

  useEffect(() => {
    try { localStorage.setItem('sidebar-open', String(sidebarOpen)); } catch {}
  }, [sidebarOpen]);

  useEffect(() => {
    try { localStorage.setItem('editor-open', String(editorOpen)); } catch {}
  }, [editorOpen]);

  const scan = useCallback(async (current: Config) => {
    const found = Object.fromEntries((await statuses(current)).map(item => [item.id, item]));
    setProviders(found);
    return found;
  }, []);

  useEffect(() => {
    if (!desktop) return;
    let active = true;
    commands.load().then(c => { if (active) { setConfig(c); setReady(true); } }).catch(fail);
    commands.detect().then(found => { if (active) setStatus(`OpenSCAD ${found.version}`.trim()); }).catch(() => { if (active) setStatus('Built-in OpenSCAD'); });
    commands.outputs().then(p => { if (active) setOutput(p); }).catch(fail);
    commands.listOutputs().then(p => { if (active) setSaved(p); }).catch(fail);
    const subscription = listen<string>('pipeline-log', e => { if (active) log(e.payload); });
    return () => { active = false; void subscription.then(unlisten => unlisten()).catch(() => {}); };
  }, [fail, log]);

  useEffect(() => {
    if (!ready || booted.current) return;
    booted.current = true;
    void work('render', false);
    void firstRun();
    if (desktop) void checkUpdates().catch(() => {});
  }, [ready]);

  useEffect(() => { document.documentElement.dataset.theme = config.theme; }, [config.theme]);
  useEffect(() => { try { localStorage.setItem('scad-draft', code); } catch { /* Editing remains available if storage is full. */ } }, [code]);
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => {
      if (desktop) void commands.save(config).catch(fail);
      else try {
        localStorage.setItem(STORAGE_CONFIG_KEY, JSON.stringify(config));
        localStorage.setItem('openscad-ai-theme', config.theme);
      } catch { /* The session keeps working without storage. */ }
    }, 300);
    return () => clearTimeout(timer);
  }, [config, fail, ready]);

  const providerReady = Boolean(providers[config.provider]?.ready);
  useEffect(() => {
    setModels([]);
    if (!providerReady) return;
    let active = true;
    // A silent refresh: the presets still work when a provider cannot list its models.
    listModels(config, config.provider).then(names => { if (active) setModels(names); }).catch(() => {});
    return () => { active = false; };
  }, [config.provider, providerReady]);

  /** Starts on whatever is already installed, and shows Connections when nothing is. */
  async function firstRun() {
    const found = await scan(config).catch(() => ({} as Record<string, ProviderStatus>));
    if (config.onboarded || !desktop) return;
    const choice = FIRST_CHOICE.find(id => found[id]?.ready);
    if (choice) {
      log(`Found ${providerInfo(choice).name}. It is ready to use.`);
      setConfig(selectProvider({ ...config, onboarded: true }, providerInfo(choice)));
    } else {
      setConfig({ ...config, onboarded: true });
      setConnections(true);
    }
  }

  async function checkUpdates() {
    const latest = await commands.latestRelease();
    if (!latest || !isNewer(latest.version, version)) return `Version ${version} is the latest.`;
    setNotice({ text: `Version ${latest.version} is available.`, action: 'Download', url: latest.url });
    return `Version ${latest.version} is available.`;
  }

  /** Asks once, after a few good designs. */
  function designDone() {
    try {
      const count = Number(localStorage.getItem('designs-done') ?? 0) + 1;
      localStorage.setItem('designs-done', String(count));
      if (count !== RATE_AFTER) return;
      setNotice({ text: 'Is OpenSCAD AI useful to you? A star helps others find it.', action: 'Star on GitHub', url: REPOSITORY });
    } catch { /* Skipped when storage is unavailable. */ }
  }

  async function run(task: (signal: AbortSignal) => Promise<void>) {
    if (operation.current) return;
    operation.current = true;
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true); setError('');
    try {
      await task(controller.signal);
    } catch (e) {
      if (isAbort(e)) log('Stopped.');
      else fail(e);
    } finally {
      operation.current = false;
      setBusy(false);
    }
  }
  function stop() {
    abort.current?.abort();
    if (desktop) void commands.cancel().catch(fail);
  }
  function tools(signal: AbortSignal): Tools {
    return {
      complete: request => complete(config, request, signal),
      compile: source => compile(config, source, 'stl', signal),
      docs,
      views: renderViews,
      log,
      progress: current => { setArtifact(current); setCode(current.code); setIssues(diagnostics(current.log)); },
    };
  }

  async function work(kind: 'generate' | 'render', save = true) {
    await run(async signal => {
      if (desktop) await commands.save(config);
      if (kind === 'render') {
        log('Compiling geometry…');
        try {
          const current = measured(code, await compile(config, code, 'stl', signal));
          setArtifact(current);
          setIssues(diagnostics(current.log));
          log(`Compiled: ${current.metrics.size.map(value => value.toFixed(2)).join(' × ')} mm`);
          if (desktop && save) await keep(current);
        } catch (e) {
          if (!isAbort(e)) setIssues(diagnostics(message(e)));
          throw e;
        }
        return;
      }
      const item = providerInfo(config.provider);
      const state = providers[item.id];
      if (state && !state.ready && !config.keys[item.id]?.trim() && (desktop || item.group === 'cloud')) {
        setConnections(true);
        throw new Error(`${item.name} is not connected yet.`);
      }
      log(`Designing with ${item.name}${config.model ? ` · ${config.model}` : ''}…`);
      const result = await design({
        prompt,
        code,
        image,
        skills: activeSkillPrompts,
        repairs: config.max_repairs,
        precise: config.mode === 'precise',
        vision: Boolean(item.vision),
      }, tools(signal));
      setArtifact(result);
      setCode(result.code);
      setIssues(diagnostics(result.log));
      if (desktop) await keep(result);
      if (!result.checks.some(check => check.level === 'fail')) designDone();
    });
  }
  async function keep(current: Design) {
    const saved = await saveDesign(current.code, current.stl);
    setName(saved);
    log(`${saved} saved`);
    setSaved(await commands.listOutputs());
  }
  async function saveSettings(c: Config) {
    setConfig(c);
    setSettings(false);
    if (!desktop) { log('Settings saved.'); return; }
    try {
      await commands.save(c);
      const found = await commands.detect().catch(() => null);
      if (found) nativeFound();
      setStatus(found ? `OpenSCAD ${found.version}`.trim() : 'Built-in OpenSCAD');
      setOutput(await commands.outputs());
      setSaved(await commands.listOutputs());
    } catch (e) { fail(e); }
  }
  async function saveConnections(c: Config) {
    setConfig(c);
    setConnections(false);
    try {
      if (desktop) await commands.save(c);
      await scan(c);
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
      const names = await listModels(config, config.provider);
      setModels(names);
      log(`${names.length} models found for ${providerInfo(config.provider).name}.`);
    } catch (e) {
      fail(e);
    } finally {
      setLoadingModels(false);
    }
  }
  function changeTheme() {
    setConfig({ ...config, theme: config.theme === 'dark' ? 'amoled' : config.theme === 'amoled' ? 'light' : 'dark' });
  }
  async function exportFile(format: 'scad' | 'stl' | '3mf' | 'step' | 'png') {
    await run(async signal => {
      const file = `${name}.${format}`;
      if (format === 'scad') {
        await report(file, await saveFile(file, code, 'text/plain;charset=utf-8'));
        return;
      }
      const mesh = artifact && !dirty ? artifact.stl : undefined;
      const compileTo = (source: string, target: string) => compile(config, source, target, signal);
      if (format === 'step') {
        const result = await buildStep(code, name, compileTo, log, mesh, signal);
        for (const note of result.notes) log(note);
        log(result.kind === 'exact'
          ? 'Exact STEP: curved faces are true cylinders, cones, and spheres.'
          : result.kind === 'mixed' ? 'Mixed STEP: analytic faces plus faceted bodies for features with no exact form.'
          : 'Faceted STEP: the solid is made of the mesh triangles.');
        await report(file, await saveFile(file, result.bytes, 'model/step'));
      } else {
        const stl = mesh ?? (await compileTo(code, 'stl')).bytes;
        const output = format === 'stl' ? stl : format === '3mf' ? await stlTo3mf(stl) : renderPng(stl);
        await report(file, await saveFile(file, output, format === 'png' ? 'image/png' : `model/${format}`));
      }
    });
  }
  async function report(file: string, path: string | null) {
    log(path ? `Saved: ${path}` : `${file} was not saved.`);
  }
  async function openFile(file?: File) {
    if (!file) return;
    if (file.size > 1_000_000) { fail('SCAD files cannot exceed 1 MB'); return; }
    try { setCode(await file.text()); setName(file.name.replace(/\.scad$/i, '') || 'model'); setArtifact(undefined); } catch (e) { fail(e); }
  }

  return (
    <div className="app">
      <Header
        theme={config.theme}
        status={status}
        available={ready}
        disabled={busy || (desktop && !ready)}
        sidebarOpen={sidebarOpen}
        activeSkillsCount={activeSkills.length}
        onTheme={changeTheme}
        onSettings={() => setSettings(true)}
        onConnections={() => setConnections(true)}
        onToggleSidebar={() => setSidebarOpen(s => !s)}
        onOpenSkills={() => setSkillsModalOpen(true)}
      />
      {!desktop && (
        <div className="web-banner">
          <span><b>LIVE WEB STUDIO</b> · OpenSCAD and the STEP converter run in your browser. Connect a provider to design with AI.</span>
          <button type="button" className="banner-button" onClick={() => setConnections(true)}>Connections</button>
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
            status={providers}
            onPrompt={setPrompt}
            onConfig={setConfig}
            onImage={file => void selectImage(file)}
            onClearImage={() => setImage(undefined)}
            onGenerate={() => void work('generate')}
            onCompileOnly={() => void work('render')}
            onOpenConnections={() => setConnections(true)}
            onModels={() => void refreshModels()}
            onCancel={stop}
            onOpenSkills={() => setSkillsModalOpen(true)}
            onAnalyze={() => {
              if (image) void run(async signal => {
                if (desktop) await commands.save(config);
                log('Analyzing reference image…');
                setPrompt(await imageBrief(image, { complete: request => complete(config, request, signal) }));
                log('Design brief ready.');
              });
            }}
          />
        )}
        <section className="workspace">
          <div className="workspace-toolbar">
            <div>
              <span className="file-dot" />
              <span className="filename">{artifact ? `${name}.scad` : 'untitled.scad'}</span>
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
              <select aria-label="Saved designs" className="saved-select" disabled={busy || !saved.length} value="" onChange={e => { const name = e.target.value; if (name) void commands.readOutput(name).then(text => { setCode(text); setName(name.replace(/\.scad$/i, '')); setArtifact(undefined); log(`${name} opened`); }).catch(fail); }}>
                <option value="">Saved designs</option>
                {saved.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
              </select>
              <label className="button">
                <FolderOpen size={15} />
                Open
                <input type="file" aria-label="Open SCAD file" accept=".scad" disabled={busy} onChange={e => { void openFile(e.target.files?.[0]); e.target.value = ''; }} />
              </label>
              {busy && <button type="button" className="stop" title="Stop the running operation" onClick={stop}><Square size={13} />Stop</button>}
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
                <MonacoEditor code={code} onChange={setCode} theme={config.theme} disabled={busy} onRun={() => void work('render')} diagnostics={issues} />
              </div>
            </div>}
            <div className="preview-panel">
              <div className="panel-caption">
                <span className="caption-label">03 / LIVE GEOMETRY</span>
                <span className="caption-actions">{!editorOpen && <button type="button" title="Show code editor" onClick={() => setEditorOpen(true)}><PanelLeftOpen size={13} /></button>}{artifact && dirty ? 'PREVIOUS COMPILE' : 'STL VIEWPORT'}</span>
              </div>
              <Viewport3D stl={artifact?.stl} theme={config.theme} size={artifact?.metrics.size} />
              {artifact && <VerificationPanel design={artifact} stale={dirty} />}
              <div className="export-bar">
                <span>{artifact ? dirty ? '○ Code changed' : '● Geometry ready' : '○ Waiting for compile'}</span>
                <button disabled={busy || !ready} onClick={() => void exportFile('scad')}><Download size={14} />SCAD</button>
                <button disabled={busy || !ready} onClick={() => void exportFile('stl')}>STL</button>
                <button disabled={busy || !ready} onClick={() => void exportFile('3mf')}>3MF</button>
                <button disabled={busy || !ready} title="Solid model for CAD software" onClick={() => void exportFile('step')}>STEP</button>
                <button disabled={busy || !ready} onClick={() => void exportFile('png')}>PNG</button>
              </div>
            </div>
          </div>
          <ParametricBar code={code} disabled={busy} onChange={setCode} />
          <LogConsole logs={logs} busy={busy} />
        </section>
      </main>
      {notice && <div className="notice" role="status">
        <span>{notice.text}</span>
        <button className="primary" onClick={() => { openLink(notice.url); setNotice(undefined); }}>{notice.action}</button>
        <button title="Dismiss" onClick={() => setNotice(undefined)}><X size={14} /></button>
      </div>}
      {error && <div className="error-banner" role="alert">{error}<button title="Dismiss error" onClick={() => setError('')}><X size={16} /></button></div>}
      <footer>
        <span>OPENSCAD AI <b>v{version}</b></span>
        <span>{desktop ? 'RUST CORE' : 'OPENSCAD WASM'} · OPENCASCADE · THREE.JS</span>
        <span>{busy ? 'Operation in progress' : 'Workspace ready'}</span>
      </footer>
      {settings && <SettingsModal config={config} defaultOutput={output} nativeAvailable={desktop} version={version} onClose={closeSettings} onSave={saveSettings}
        onChooseOutput={desktop ? commands.chooseOutput : async () => null} onCheckUpdates={checkUpdates} onRate={() => openLink(REPOSITORY)}
        onSync={async () => { if (!desktop) return; try { log(`${await commands.sync()} documentation sources cached`); } catch (e) { fail(e); } }} />}
      {connections && <ConnectionsModal config={config} onClose={closeConnections} onSave={saveConnections} />}
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
