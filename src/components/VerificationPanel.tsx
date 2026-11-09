import { useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, XCircle } from 'lucide-react';
import type { Design } from '../ai/pipeline';

const ICONS = { pass: CheckCircle2, warn: AlertTriangle, fail: XCircle };

export default function VerificationPanel({ design, stale }: { design: Design; stale: boolean }) {
  const [open, setOpen] = useState(false);
  const count = (level: string) => design.checks.filter(check => check.level === level).length;
  const fails = count('fail'), warns = count('warn');
  const headline = fails ? `${fails} check${fails === 1 ? '' : 's'} failed` : warns ? `Passed with ${warns} warning${warns === 1 ? '' : 's'}` : 'All checks passed';
  return <section className="verification">
    <button type="button" className="verification-title" aria-expanded={open} onClick={() => setOpen(!open)}>
      <span className={`verdict ${fails ? 'fail' : warns ? 'warn' : 'pass'}`}>{headline}</span>
      <small>{stale ? 'For the previous compile' : `${(design.metrics.volume / 1000).toFixed(1)} cm³`}</small>
      <ChevronDown size={14} className={open ? 'flip' : ''} />
    </button>
    {open && <div className="verification-body">
      <ul>
        {design.checks.map(check => {
          const Icon = ICONS[check.level];
          return <li key={check.id} className={check.level}><Icon size={13} /><span>{check.label}{check.detail && <small>{check.detail}</small>}</span></li>;
        })}
      </ul>
      {Boolean(design.spec?.assumptions.length) && <div className="assumptions">
        <b>Assumptions the plan made</b>
        {design.spec!.assumptions.map(item => <span key={item}>{item}</span>)}
      </div>}
    </div>}
  </section>;
}
