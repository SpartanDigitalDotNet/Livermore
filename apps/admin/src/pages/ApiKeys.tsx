import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { trpc, trpcClient } from '@/lib/trpc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ApiKeyTable } from '@/components/api-keys/ApiKeyTable';

/**
 * API Keys Management Page
 *
 * Allows admins to create, view, regenerate, and deactivate API keys
 * for the public REST API. Full key value is shown exactly once on
 * creation or regeneration.
 */
export function ApiKeys() {
  const queryClient = useQueryClient();
  const [newKeyName, setNewKeyName] = useState('');
  const [revealedKey, setRevealedKey] = useState<{ key: string; name: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // Fetch all API keys
  const { data: keys, isLoading, error } = useQuery(
    trpc.apiKey.list.queryOptions()
  );

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (name: string) => trpcClient.apiKey.create.mutate({ name }),
    onSuccess: (data) => {
      toast.success(`API key "${data.name}" created`);
      setRevealedKey({ key: data.key, name: data.name });
      setNewKeyName('');
      setCopied(false);
      queryClient.invalidateQueries({ queryKey: [['apiKey', 'list']] });
    },
    onError: (err) => {
      toast.error(`Failed to create key: ${err.message}`);
    },
  });

  // Regenerate mutation
  const regenerateMutation = useMutation({
    mutationFn: (id: number) => trpcClient.apiKey.regenerate.mutate({ id }),
    onSuccess: (data) => {
      toast.success(`API key "${data.name}" regenerated`);
      setRevealedKey({ key: data.key, name: data.name });
      setCopied(false);
      queryClient.invalidateQueries({ queryKey: [['apiKey', 'list']] });
    },
    onError: (err) => {
      toast.error(`Failed to regenerate key: ${err.message}`);
    },
  });

  // Deactivate mutation
  const deactivateMutation = useMutation({
    mutationFn: (id: number) => trpcClient.apiKey.deactivate.mutate({ id }),
    onSuccess: (data) => {
      toast.success(`API key "${data.name}" deactivated`);
      queryClient.invalidateQueries({ queryKey: [['apiKey', 'list']] });
    },
    onError: (err) => {
      toast.error(`Failed to deactivate key: ${err.message}`);
    },
  });

  const handleCreate = () => {
    const trimmed = newKeyName.trim();
    if (!trimmed) {
      toast.error('Please enter a name for the API key');
      return;
    }
    createMutation.mutate(trimmed);
  };

  const handleCopy = async () => {
    if (!revealedKey) return;
    try {
      await navigator.clipboard.writeText(revealedKey.key);
      setCopied(true);
      toast.success('Key copied to clipboard');
    } catch {
      toast.error('Failed to copy -- please select and copy manually');
    }
  };

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>API Keys</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-md bg-red-50 p-4 text-red-700 dark:bg-red-950/50 dark:text-red-400">
            Error loading API keys: {error.message}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">API Keys</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Manage API keys for public API access.
        </p>
      </div>

      {/* Create API Key */}
      <Card>
        <CardHeader>
          <CardTitle>Create API Key</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              placeholder="Key name (e.g., Production, Staging)"
              className="flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500 dark:focus:border-gray-400 dark:focus:ring-gray-400"
            />
            <Button
              onClick={handleCreate}
              disabled={createMutation.isPending || !newKeyName.trim()}
            >
              {createMutation.isPending ? 'Creating...' : 'Create'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Revealed Key Display */}
      {revealedKey && (
        <Card className="border-amber-300 dark:border-amber-700">
          <CardContent className="pt-6">
            <div className="rounded-md bg-amber-50 p-4 dark:bg-amber-950/30">
              <p className="mb-2 text-sm font-medium text-amber-800 dark:text-amber-300">
                Save this key now. It won't be shown again.
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded bg-white px-3 py-2 font-mono text-sm text-gray-900 dark:bg-gray-800 dark:text-gray-100">
                  {revealedKey.key}
                </code>
                <Button variant="outline" size="sm" onClick={handleCopy}>
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
              <div className="mt-3 flex justify-end">
                <Button variant="ghost" size="sm" onClick={() => setRevealedKey(null)}>
                  Dismiss
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Key List */}
      <Card>
        <CardHeader>
          <CardTitle>Existing Keys</CardTitle>
        </CardHeader>
        <CardContent>
          <ApiKeyTable
            keys={keys ?? []}
            onRegenerate={(id) => regenerateMutation.mutate(id)}
            onDeactivate={(id) => deactivateMutation.mutate(id)}
            isLoading={isLoading}
          />
        </CardContent>
      </Card>
    </div>
  );
}
