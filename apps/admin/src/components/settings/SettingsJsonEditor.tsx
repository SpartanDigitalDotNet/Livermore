import { useCallback, useRef, useEffect } from 'react';
import Editor, { OnMount, OnChange, Monaco } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';

interface SettingsJsonEditorProps {
  /** JSON string value to display/edit */
  value: string;
  /** Callback when JSON content changes */
  onChange: (value: string) => void;
  /** Whether the editor is read-only */
  readOnly?: boolean;
  /** Editor height (CSS value) */
  height?: string;
  /** Validation error message to display as marker */
  validationError?: string;
}

/**
 * Monaco-based JSON editor for settings.
 * Provides syntax highlighting, formatting, and validation markers.
 * Satisfies UI-SET-02.
 */
export function SettingsJsonEditor({
  value,
  onChange,
  readOnly = false,
  height = '400px',
  validationError,
}: SettingsJsonEditorProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);

  const handleEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    // Format document on mount
    setTimeout(() => {
      editor.getAction('editor.action.formatDocument')?.run();
    }, 100);
  };

  const handleChange: OnChange = useCallback(
    (newValue) => {
      if (newValue !== undefined) {
        onChange(newValue);
      }
    },
    [onChange]
  );

  // Update validation markers when error changes
  useEffect(() => {
    if (!editorRef.current || !monacoRef.current) return;

    const model = editorRef.current.getModel();
    if (!model) return;

    if (validationError) {
      // Set error marker on first line
      monacoRef.current.editor.setModelMarkers(model, 'settings-validation', [
        {
          startLineNumber: 1,
          startColumn: 1,
          endLineNumber: 1,
          endColumn: model.getLineMaxColumn(1),
          message: validationError,
          severity: monacoRef.current.MarkerSeverity.Error,
        },
      ]);
    } else {
      // Clear markers
      monacoRef.current.editor.setModelMarkers(model, 'settings-validation', []);
    }
  }, [validationError]);

  return (
    <div className="border rounded-md overflow-hidden">
      <Editor
        height={height}
        language="json"
        value={value}
        onChange={handleChange}
        onMount={handleEditorMount}
        options={{
          readOnly,
          minimap: { enabled: false },
          lineNumbers: 'on',
          scrollBeyondLastLine: false,
          formatOnPaste: true,
          formatOnType: true,
          tabSize: 2,
          wordWrap: 'on',
          automaticLayout: true,
          folding: true,
          foldingStrategy: 'indentation',
        }}
        theme="vs-dark"
        loading={
          <div className="flex items-center justify-center h-full bg-gray-900 text-gray-400">
            Loading editor...
          </div>
        }
      />
    </div>
  );
}
