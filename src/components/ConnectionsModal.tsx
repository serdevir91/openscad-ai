import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, ClipboardCopy, ExternalLink, KeyRound, LogIn, Plug, RefreshCw, ShieldCheck, X, XCircle } from 'lucide-react';
import { useDialog } from '../hooks/useDialog';
import { commands, desktop, type Config, type ProviderStatus } from '../hooks/useTauriCommands';
import { GROUPS, available, type Provider } from '../ai/providers';
import { openLink, statuses, testProvider } from '../ai/transport';

type Props = { config: Config; onClose: () => void; onSave: (config: Config) => Promise<void> };
type Result = { id: string; ok: boolean; text: string };

export function selectProvider(config: Config, item: Provider): Config {
  return { ...config, provider: item.id, model: config.models[item.id] ?? item.model };
}

export default function ConnectionsModal({ config, onClose, onSave }: Props) {
  const [draft, setDraft] = useState(config);
  const [status, setStatus] = useState<Record<string, ProviderStatus>>({});
  const [open, setOpen] = useState(config.provider);
  const [testing, setTesting] = useState('');
  const [result, setResult] = useState<Result>();
  const [scanning, setScanning] = useState(false);
  const dialog = useRef<HTMLElement>(null);
  useDialog(dialog, onClose, Boolean(testing));

  const scan = useCallback(async (current: Config) => {
    setScanning(true);
    try { setStatus(Object.fromEntries((await statuses(current)).map(item => [item.id, item]))); }
    finally { setScanning(false); }
  }, []);
  useEffect(() => { void scan(config); }, [config, scan]);

  const setIn = (field: 'keys' | 'base_urls' | 'paths', id: string, value: string) =>
    setDraft(current => ({ ...current, [field]: { ...current[field], [id]: value } }));

  async function test(item: Provider) {
    setTesting(item.id);
    setResult(undefined);
    try {
      const reply = await testProvider(selectProvider(draft, item));
      setResult({ id: item.id, ok: true, text: `Connected. It replied: ${reply.trim().slice(0, 60)}` });
    } catch (error) {
      setResult({ id: item.id, ok: false, text: String(error instanceof Error ? error.message : error) });
    } finally {
      setTesting('');
    }
  }

  function ready(item: Provider) {
    return Boolean(draft.keys[item.id]?.trim()) || Boolean(status[item.id]?.ready);
  }

  function card(item: Provider) {
    const active = draft.provider === item.id;
    const expanded = open === item.id;
    const state = status[item.id];
    return <article key={item.id} className={`provider-card ${active ? 'active' : ''}`}>
      <div className="provider-row">
        <button type="button" className="provider-main" aria-expanded={expanded} onClick={() => setOpen(expanded ? '' : item.id)}>
          <i className={ready(item) ? 'ready' : ''} />
          <span><b>{item.name}</b><small>{state?.detail && ready(item) ? state.detail : item.note}</small></span>
        </button>
        {active
          ? <span className="provider-active">In use</span>
          : <button type="button" onClick={() => setDraft(selectProvider(draft, item))}>Use</button>}
      </div>
      {expanded && <div className="provider-body">
        {item.group === 'cli' && !state?.ready && (item.install
          ? <div className="install-line">
              <code>{item.install}</code>
              <button type="button" title="Copy install command" onClick={() => void navigator.clipboard.writeText(item.install!)}><ClipboardCopy size={14} /></button>
            </div>
          : <p className="settings-hint">Install it from the official site, then scan again.</p>)}
        {(item.group === 'cloud' || item.keyHint) && <label className="settings-field">
          <span>API key</span>
          <input type="password" autoComplete="off" value={draft.keys[item.id] ?? ''} placeholder={item.keyHint ?? ''} onChange={e => setIn('keys', item.id, e.target.value)} />
        </label>}
        {item.baseUrl !== undefined && <label className="settings-field">
          <span>Endpoint URL</span>
          <input value={draft.base_urls[item.id] ?? ''} placeholder={item.baseUrl || 'https://example.com/v1'} onChange={e => setIn('base_urls', item.id, e.target.value)} />
        </label>}
        {item.group === 'cli' && <label className="settings-field">
          <span>Executable path</span>
          <input value={draft.paths[item.id] ?? ''} placeholder={state?.path ?? 'Found automatically'} onChange={e => setIn('paths', item.id, e.target.value)} />
        </label>}
        <div className="provider-actions">
          {item.keyUrl && <button type="button" onClick={() => openLink(item.keyUrl!)}><KeyRound size={14} />Get a key<ExternalLink size={12} /></button>}
          {item.installUrl && !state?.ready && <button type="button" onClick={() => openLink(item.installUrl!)}><ExternalLink size={14} />Install guide</button>}
          {item.login && state?.ready && <button type="button" title={item.login} onClick={() => { void commands.login(draft, item.id).catch(error => setResult({ id: item.id, ok: false, text: String(error) })); }}><LogIn size={14} />Sign in</button>}
          <button type="button" disabled={Boolean(testing)} onClick={() => void test(item)}><Plug size={14} />{testing === item.id ? 'Testing…' : 'Test connection'}</button>
        </div>
        {result?.id === item.id && <div className={`connection-result ${result.ok ? 'success' : 'failure'}`}>{result.ok ? <CheckCircle2 size={15} /> : <XCircle size={15} />}<span>{result.text}</span></div>}
      </div>}
    </article>;
  }

  const list = available(desktop);
  return <div className="modal-backdrop settings-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !testing) onClose(); }}>
    <section ref={dialog} role="dialog" aria-modal="true" aria-labelledby="connections-title" className="modal settings-modal">
      <div className="settings-hero">
        <div><span className="settings-kicker">AI PROVIDERS</span><h2 id="connections-title">Connections</h2><p>{desktop ? 'Pick the model that writes your designs. Anything already on this computer is found for you.' : 'Pick the model that writes your designs.'}</p></div>
        <button className="icon-button" title="Close connections" onClick={onClose}><X size={18} /></button>
      </div>
      <div className="settings-scroll">
        {GROUPS.map(group => {
          const items = list.filter(item => item.group === group.id);
          if (!items.length) return null;
          return <section key={group.id} className="provider-group">
            <h3>{group.title}</h3>
            <p>{group.note}</p>
            {items.map(card)}
          </section>;
        })}
        <div className="privacy-note">
          <ShieldCheck size={16} />
          <span>{desktop
            ? 'Keys are written only to your local application data directory, readable by your account alone.'
            : 'Keys stay in this browser and go directly to the provider you choose. Sign-in CLIs need the desktop app.'}</span>
        </div>
      </div>
      <div className="settings-footer">
        <button type="button" disabled={scanning} onClick={() => void scan(draft)}><RefreshCw size={15} className={scanning ? 'spin' : ''} />Scan again</button>
        <div><button onClick={onClose}>Cancel</button><button className="primary" onClick={() => void onSave(draft)}>Save</button></div>
      </div>
    </section>
  </div>;
}
