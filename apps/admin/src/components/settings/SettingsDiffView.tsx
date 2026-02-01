import { DiffEditor } from '@monaco-editor/react';

interface SettingsDiffViewProps {
  /** Original JSON string (left side) */
  original: string;
  /** Modified JSON string (right side) */
  modified: string;
  /** Editor height (CSS value) */
  height?: string;
}

/**
 * Monaco DiffEditor wrapper for comparing settings versions.
 * Shows side-by-side comparison of original vs modified settings.
 * Satisfies UI-SET-04.
 */
export function SettingsDiffView({
  original,
  modified,
  height = '400px',
}: SettingsDiffViewProps) {
  // Format JSON strings for consistent comparison
  const formatJson = (json: string): string => {
    try {
      return JSON.stringify(JSON.parse(json), null, 2);
    } catch {
      return json;
    }
  };

  const formattedOriginal = formatJson(original);
  const formattedModified = formatJson(modified);

  // Check if there are actual changes
  const hasChanges = formattedOriginal !== formattedModified;

  if (!hasChanges) {
    return (
      <div className="flex items-center justify-center h-32 bg-gray-100 rounded-md text-gray-600">
        No changes detected
      </div>
    );
  }

  return (
    <div className="border rounded-md overflow-hidden">
      <div className="flex bg-gray-800 text-gray-300 text-xs">
        <div className="flex-1 px-4 py-2 border-r border-gray-700">
          Original (Saved)
        </div>
        <div className="flex-1 px-4 py-2">
          Modified (Unsaved)
        </div>
      </div>
      <DiffEditor
        height={height}
        language="json"
        original={formattedOriginal}
        modified={formattedModified}
        options={{
          readOnly: true,
          renderSideBySide: true,
          enableSplitViewResizing: true,
          ignoreTrimWhitespace: false,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          lineNumbers: 'on',
          folding: true,
        }}
        theme="vs-dark"
        loading={
          <div className="flex items-center justify-center h-full bg-gray-900 text-gray-400">
            Loading diff viewer...
          </div>
        }
      />
    </div>
  );
}
