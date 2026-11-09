export type Diagnostic = { line?: number; severity: 'error' | 'warning'; message: string };

const ENTRY = /^(ERROR|WARNING|TRACE):\s*(.*)$/;
const LOCATION = /,?\s*(?:in file [^,]*,\s*)?line (\d+)\.?\s*$/i;

/** Pulls errors and warnings, with their source lines, out of an OpenSCAD console log. */
export function diagnostics(log: string): Diagnostic[] {
  const found: Diagnostic[] = [];
  for (const raw of log.split('\n')) {
    const entry = raw.trim().match(ENTRY);
    if (!entry || entry[1] === 'TRACE') continue;
    const at = entry[2].match(LOCATION);
    const message = (at ? entry[2].slice(0, at.index) : entry[2]).trim();
    found.push({ severity: entry[1] === 'ERROR' ? 'error' : 'warning', message, line: at ? Number(at[1]) : undefined });
  }
  return found;
}
