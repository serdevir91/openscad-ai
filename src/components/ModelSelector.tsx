import { useState } from 'react';
import { RefreshCw, ChevronDown, Check } from 'lucide-react';
import { provider as providerInfo } from '../ai/providers';

type Props = {
  provider: string;
  currentModel: string;
  fetchedModels: string[];
  loadingModels: boolean;
  disabled: boolean;
  onChangeModel: (model: string) => void;
  onRefreshModels: () => void;
};

export default function ModelSelector({
  provider,
  currentModel,
  fetchedModels,
  loadingModels,
  disabled,
  onChangeModel,
  onRefreshModels,
}: Props) {
  const [showAll, setShowAll] = useState(false);
  const presets = providerInfo(provider).presets;

  return (
    <div className="model-selector">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <label className="field-label" style={{ margin: 0 }}>MODEL</label>
        <button
          title="Refresh models from the server or API"
          disabled={disabled || loadingModels}
          onClick={onRefreshModels}
          style={{ padding: '3px 7px', fontSize: '10px', height: '22px', border: 'none', color: 'var(--muted)' }}
        >
          <RefreshCw size={11} className={loadingModels ? 'spin' : ''} />
          <span>{loadingModels ? 'Scanning…' : 'Refresh'}</span>
        </button>
      </div>

      {/* Quick-select pills */}
      <div className="model-pills">
        {presets.map(p => {
          const active = currentModel === p.id;
          return (
            <button
              key={p.id}
              type="button"
              className={`model-pill ${active ? 'active' : ''}`}
              disabled={disabled}
              onClick={() => onChangeModel(p.id)}
              title={p.id}
            >
              <span>{p.label}</span>
            </button>
          );
        })}
      </div>

      {/* Custom input or select */}
      <div className="model-custom-row">
        <div style={{ position: 'relative', flex: 1 }}>
          <input
            id="model-custom-input"
            aria-label="Active model name"
            value={currentModel}
            disabled={disabled}
            placeholder={providerInfo(provider).model || 'Provider default'}
            onChange={e => onChangeModel(e.target.value)}
            style={{ paddingRight: '28px' }}
          />
          {fetchedModels.length > 0 && (
            <button
              type="button"
              title="Toggle full model list"
              onClick={() => setShowAll(!showAll)}
              style={{
                position: 'absolute',
                right: '4px',
                top: '50%',
                transform: 'translateY(-50%)',
                border: 'none',
                padding: '4px',
                background: 'transparent',
                color: 'var(--muted)',
              }}
            >
              <ChevronDown size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Dropdown list if user toggles all fetched models */}
      {showAll && fetchedModels.length > 0 && (
        <div
          style={{
            background: 'var(--sub)',
            border: '1px solid var(--border)',
            borderRadius: '6px',
            maxHeight: '180px',
            overflowY: 'auto',
            padding: '4px',
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
          }}
        >
          {fetchedModels.map(m => (
            <button
              key={m}
              type="button"
              onClick={() => {
                onChangeModel(m);
                setShowAll(false);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '6px 10px',
                fontSize: '11px',
                fontFamily: 'Consolas, monospace',
                textAlign: 'left',
                border: 'none',
                borderRadius: '4px',
                background: currentModel === m ? 'var(--input)' : 'transparent',
                color: currentModel === m ? 'var(--accent)' : 'var(--text)',
                cursor: 'pointer',
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m}</span>
              {currentModel === m && <Check size={12} color="var(--accent)" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
