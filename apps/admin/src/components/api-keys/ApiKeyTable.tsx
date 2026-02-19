import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

interface ApiKeyRow {
  id: number;
  name: string;
  keyPreview: string;
  isActive: boolean;
  lastUsedAt: string | null;
  createdAt: string;
}

interface ApiKeyTableProps {
  keys: ApiKeyRow[];
  onRegenerate: (id: number) => void;
  onDeactivate: (id: number) => void;
  isLoading: boolean;
}

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHr / 24);

  if (diffSec < 60) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export function ApiKeyTable({ keys, onRegenerate, onDeactivate, isLoading }: ApiKeyTableProps) {
  const [confirmDialog, setConfirmDialog] = useState<{
    type: 'regenerate' | 'deactivate';
    id: number;
    name: string;
  } | null>(null);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-gray-600 dark:border-gray-700 dark:border-t-gray-400" />
      </div>
    );
  }

  if (keys.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
        No API keys yet. Create one above.
      </p>
    );
  }

  const handleConfirm = () => {
    if (!confirmDialog) return;
    if (confirmDialog.type === 'regenerate') {
      onRegenerate(confirmDialog.id);
    } else {
      onDeactivate(confirmDialog.id);
    }
    setConfirmDialog(null);
  };

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700">
              <th className="px-3 py-2 text-left font-medium text-gray-500 dark:text-gray-400">Name</th>
              <th className="px-3 py-2 text-left font-medium text-gray-500 dark:text-gray-400">Key Preview</th>
              <th className="px-3 py-2 text-left font-medium text-gray-500 dark:text-gray-400">Status</th>
              <th className="px-3 py-2 text-left font-medium text-gray-500 dark:text-gray-400">Last Used</th>
              <th className="px-3 py-2 text-left font-medium text-gray-500 dark:text-gray-400">Created</th>
              <th className="px-3 py-2 text-right font-medium text-gray-500 dark:text-gray-400">Actions</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id} className="border-b border-gray-100 dark:border-gray-800">
                <td className="px-3 py-3 font-medium text-gray-900 dark:text-gray-100">{k.name}</td>
                <td className="px-3 py-3 font-mono text-xs text-gray-600 dark:text-gray-400">{k.keyPreview}</td>
                <td className="px-3 py-3">
                  {k.isActive ? (
                    <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
                      Active
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
                      Inactive
                    </span>
                  )}
                </td>
                <td className="px-3 py-3 text-gray-600 dark:text-gray-400">{formatRelativeTime(k.lastUsedAt)}</td>
                <td className="px-3 py-3 text-gray-600 dark:text-gray-400">{formatRelativeTime(k.createdAt)}</td>
                <td className="px-3 py-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setConfirmDialog({ type: 'regenerate', id: k.id, name: k.name })}
                    >
                      Regenerate
                    </Button>
                    {k.isActive && (
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => setConfirmDialog({ type: 'deactivate', id: k.id, name: k.name })}
                      >
                        Deactivate
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Confirmation Dialog */}
      <Dialog open={!!confirmDialog} onOpenChange={(open) => !open && setConfirmDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirmDialog?.type === 'regenerate' ? 'Regenerate API Key' : 'Deactivate API Key'}
            </DialogTitle>
            <DialogDescription>
              {confirmDialog?.type === 'regenerate'
                ? `This will invalidate the current key for "${confirmDialog?.name}". Any integrations using it will stop working immediately. Continue?`
                : `This key "${confirmDialog?.name}" will stop working immediately. This action cannot be undone. Continue?`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDialog(null)}>
              Cancel
            </Button>
            <Button
              variant={confirmDialog?.type === 'deactivate' ? 'destructive' : 'default'}
              onClick={handleConfirm}
            >
              {confirmDialog?.type === 'regenerate' ? 'Regenerate' : 'Deactivate'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
