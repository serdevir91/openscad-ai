export type Parameter = { name: string; value: number; start: number; end: number; min: number; max: number; step: number };

// Offset-preserving lexical masking: comments/strings cannot become parameters.
// This deliberately supports literal top-level assignments, not evaluated expressions.
export function parameters(code: string): Parameter[] {
  const masked = code.replace(/\/\*[\s\S]*?(?:\*\/|$)|\/\/[^\n]*|"(?:\\.|[^"\\])*"/g, s => s.replace(/[^\n]/g, ' '));
  const depthAt = new Int32Array(masked.length);
  let depth = 0;
  for (let i = 0; i < masked.length; i++) {
    depthAt[i] = depth;
    if ('{(['.includes(masked[i])) depth++;
    if ('})]'.includes(masked[i])) depth--;
  }
  const result: Parameter[] = [];
  const re = /(?:\$?[A-Za-z_][\w]*)\s*=\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*;/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(masked))) {
    if (depthAt[match.index] !== 0) continue;
    const prefix = masked.slice(0, match.index).trimEnd();
    // Exclude unbraced module/function/if/for bodies and chained assignments.
    if (prefix && !';}'.includes(prefix.at(-1)!)) continue;
    const name = match[0].slice(0, match[0].indexOf('=')).trim();
    const value = Number(match[1]);
    if (!Number.isFinite(value) || Math.abs(value) > 1e12) continue;
    const start = match.index + match[0].indexOf(match[1], match[0].indexOf('=') + 1);
    const lineEnd = code.indexOf('\n', re.lastIndex);
    const comment = code.slice(re.lastIndex, lineEnd < 0 ? code.length : lineEnd);
    const custom = comment.match(/^\s*\/\/\s*\[\s*([+-]?[\d.]+)\s*:\s*([+-]?[\d.]+)(?:\s*:\s*([+-]?[\d.]+))?\s*\]/);
    let min = Math.min(0, value * 2), max = Math.max(10, Math.abs(value) * 3);
    let step = Number.isInteger(value) ? 1 : Math.min(0.1, 10 ** Math.floor(Math.log10(Math.abs(value) || 0.1)));
    if (name === '$fn') {
      min = 12;
      max = 128;
      step = 1;
    }
    if (custom) {
      const values = custom.slice(1).filter(v => v !== undefined).map(Number);
      const low = values[0], high = values.at(-1)!, increment = values.length === 3 ? values[1] : step;
      if (values.every(Number.isFinite) && low < high && increment > 0) { min = Math.min(low, value); max = Math.max(high, value); step = increment; }
    }
    result.push({ name, value, start, end: start + match[1].length, min, max, step });
  }
  // Repeated OpenSCAD assignments have special semantics; leave them to the editor.
  return result.filter(p => result.filter(other => other.name === p.name).length === 1);
}

export function setParameter(code: string, parameter: Parameter, value: number) {
  if (!Number.isFinite(value)) return code;
  const clamped = parameter.name === '$fn' ? Math.max(4, Math.min(256, Math.round(value))) : value;
  return code.slice(0, parameter.start) + clamped + code.slice(parameter.end);
}
