import { useEffect, useRef, useState } from 'react';
import { Terminal, ChevronDown } from 'lucide-react';

export default function LogConsole({ logs, busy }: { logs: string[]; busy: boolean }) {
  const [expanded, setExpanded] = useState(true);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { if (list.current) list.current.scrollTop = list.current.scrollHeight; }, [logs, expanded]);
  return <section className="console"><button className="console-title" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}><Terminal size={14} /> OPERATION LOG <span>{busy ? '● RUNNING' : 'READY'}</span><ChevronDown size={14} /></button>
    {expanded && <div className="log-lines" ref={list} role="log">{logs.map((line, i) => <div key={i}><span>{String(i + 1).padStart(2, '0')}</span>{line}</div>)}</div>}
  </section>;
}
