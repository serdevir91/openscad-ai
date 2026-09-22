import { parameters, setParameter } from '../hooks/useParametric';

export default function ParametricBar({ code, disabled, onChange }: { code: string; disabled: boolean; onChange: (v: string) => void }) {
  const params = parameters(code);
  return (
    <div className="parameters">
      <div className="section-title">
        <span>04 / PARAMETERS</span>
        <small>{params.length} VARIABLES · TYPE OR DRAG TO ADJUST</small>
      </div>
      <div className="slider-grid">
        {params.map(p => (
          <div key={p.name} className="param-card">
            <div className="param-header">
              <span className="param-name" title={p.name}>{p.name}</span>
              <input
                aria-label={`${p.name} numeric value`}
                type="number"
                className="param-number-input"
                step={p.step}
                value={p.value}
                disabled={disabled}
                onChange={e => {
                  const val = parseFloat(e.target.value);
                  if (Number.isFinite(val)) {
                    onChange(setParameter(code, p, val));
                  }
                }}
              />
            </div>
            <input
              aria-label={`${p.name} slider`}
              type="range"
              min={p.min}
              max={p.max}
              step={p.step}
              value={p.value}
              disabled={disabled}
              onChange={e => onChange(setParameter(code, p, Number(e.target.value)))}
            />
          </div>
        ))}
        {!params.length && <p style={{ color: 'var(--muted)', fontSize: '11px', gridColumn: '1 / -1', margin: '6px 0' }}>Top-level numeric variables appear here: width = 50; height = 20;</p>}
      </div>
    </div>
  );
}
