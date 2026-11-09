import { useEffect, useRef } from 'react';
import Editor, { loader, type OnMount } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import Worker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import type { Diagnostic } from '../cad/diagnostics';

self.MonacoEnvironment = { getWorker: () => new Worker() };
loader.config({ monaco });

const OPENSCAD_KEYWORDS = [
  'module', 'function', 'if', 'else', 'for', 'intersection_for', 'let', 'each',
  'true', 'false', 'undef', 'include', 'use'
];

const OPENSCAD_BUILTINS = [
  'cube', 'sphere', 'cylinder', 'polyhedron', 'square', 'circle', 'polygon', 'text',
  'union', 'difference', 'intersection', 'render'
];

const OPENSCAD_TRANSFORMS = [
  'translate', 'rotate', 'scale', 'resize', 'mirror', 'multmatrix', 'color',
  'offset', 'hull', 'minkowski', 'linear_extrude', 'rotate_extrude', 'projection'
];

const OPENSCAD_MATH = [
  'abs', 'sign', 'sin', 'cos', 'tan', 'acos', 'asin', 'atan', 'atan2',
  'floor', 'round', 'ceil', 'ln', 'log', 'pow', 'sqrt', 'exp',
  'min', 'max', 'norm', 'cross', 'concat', 'lookup', 'str', 'chr', 'search',
  'version', 'version_num', 'parent_module', 'len'
];

const OPENSCAD_SPECIAL_VARS = [
  '$fn', '$fa', '$fs', '$t', '$vpr', '$vpt', '$vpd', '$children', '$preview'
];

monaco.languages.register({ id: 'openscad' });
monaco.languages.setMonarchTokensProvider('openscad', {
  keywords: OPENSCAD_KEYWORDS,
  builtins: OPENSCAD_BUILTINS,
  transforms: OPENSCAD_TRANSFORMS,
  math: OPENSCAD_MATH,
  specialVars: OPENSCAD_SPECIAL_VARS,
  tokenizer: {
    root: [
      [/\/\/.*$/, 'comment'],
      [/\/\*/, 'comment', '@comment'],
      [/"(?:\\.|[^"\\])*"/, 'string'],
      [/\$[a-zA-Z0-9_]+/, {
        cases: {
          '@specialVars': 'variable.predefined',
          '@default': 'variable'
        }
      }],
      [/[a-zA-Z_][\w]*/, {
        cases: {
          '@keywords': 'keyword',
          '@builtins': 'type.identifier',
          '@transforms': 'tag',
          '@math': 'support.function',
          '@default': 'identifier'
        }
      }],
      [/-?\d*\.?\d+(?:[eE][-+]?\d+)?/, 'number'],
      [/[{}()[\]]/, '@brackets'],
      [/[<>!=]=?|[&|*+/%~-]/, 'operator'],
      [/[,;:]/, 'delimiter'],
    ],
    comment: [
      [/[^/*]+/, 'comment'],
      [/\*\//, 'comment', '@pop'],
      [/[/*]/, 'comment']
    ]
  }
});

interface MonacoEditorProps {
  code: string;
  onChange: (s: string) => void;
  theme: string;
  disabled: boolean;
  onRun?: () => void;
  diagnostics?: Diagnostic[];
}

export default function MonacoEditor({ code, onChange, theme, disabled, onRun, diagnostics = [] }: MonacoEditorProps) {
  const model = useRef<monaco.editor.ITextModel | null>(null);
  const run = useRef(onRun);
  run.current = onRun;

  useEffect(() => {
    if (!model.current) return;
    monaco.editor.setModelMarkers(model.current, 'openscad', diagnostics.filter(item => item.line).map(item => ({
      severity: item.severity === 'error' ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
      message: item.message,
      startLineNumber: item.line!,
      endLineNumber: item.line!,
      startColumn: 1,
      endColumn: 1000,
    })));
  }, [diagnostics]);

  const handleEditorDidMount: OnMount = (editor, monacoInstance) => {
    model.current = editor.getModel();
    editor.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.Enter, () => {
      run.current?.();
    });
  };

  return (
    <Editor
      height="100%"
      language="openscad"
      theme={theme === 'light' ? 'vs' : 'vs-dark'}
      value={code}
      onChange={v => onChange(v ?? '')}
      onMount={handleEditorDidMount}
      options={{
        readOnly: disabled,
        fontSize: 13,
        fontFamily: 'Cascadia Code, Consolas, monospace',
        minimap: { enabled: false },
        padding: { top: 16, bottom: 16 },
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 2,
        wordWrap: 'on',
        bracketPairColorization: { enabled: true },
        renderLineHighlight: 'all',
      }}
    />
  );
}
