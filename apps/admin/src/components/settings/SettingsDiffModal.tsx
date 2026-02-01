import { SettingsDiffView } from './SettingsDiffView';

interface SettingsDiffModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Original settings JSON string */
  original: string;
  /** Modified settings JSON string */
  modified: string;
  /** Callback when user confirms save */
  onConfirm: () => void;
  /** Callback when user cancels */
  onCancel: () => void;
  /** Whether save is in progress */
  isSaving?: boolean;
}

/**
 * Modal dialog showing settings diff with confirm/cancel actions.
 * Satisfies UI-SET-04.
 */
export function SettingsDiffModal({
  isOpen,
  original,
  modified,
  onConfirm,
  onCancel,
  isSaving = false,
}: SettingsDiffModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onCancel}
        aria-hidden="true"
      />

      {/* Modal */}
      <div className="relative bg-white rounded-lg shadow-xl max-w-5xl w-full mx-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b">
          <h2 className="text-lg font-semibold text-gray-900">
            Review Changes
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Review your changes before saving. Original settings are on the left,
            your modifications are on the right.
          </p>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          <SettingsDiffView
            original={original}
            modified={modified}
            height="400px"
          />
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSaving}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-500 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isSaving}
            className="px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-md hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-500 disabled:opacity-50"
          >
            {isSaving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
