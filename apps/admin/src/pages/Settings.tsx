import { useState, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { trpc, trpcClient } from '@/lib/trpc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SettingsSplitView, SettingsDiffModal } from '@/components/settings';
import { UserSettingsSchema, type UserSettings } from '@livermore/schemas';

export function Settings() {
  const queryClient = useQueryClient();

  // Fetch settings
  const { data, isLoading, error, refetch, isFetching } = useQuery(
    trpc.settings.get.queryOptions()
  );

  // Track current settings and dirty state
  const [currentSettings, setCurrentSettings] = useState<UserSettings | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  // Diff modal state
  const [showDiffModal, setShowDiffModal] = useState(false);

  // Validation error state
  const [validationError, setValidationError] = useState<string | null>(null);

  // Key to force remount of SettingsSplitView on discard
  const splitViewKey = useRef(0);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: (settings: UserSettings) =>
      trpcClient.settings.update.mutate(settings),
    onSuccess: () => {
      toast.success('Settings saved successfully');
      setShowDiffModal(false);
      setIsDirty(false);
      setValidationError(null);
      // Invalidate and refetch
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (err) => {
      toast.error(`Failed to save: ${err.message}`);
    },
  });

  // Handle settings changes from split view
  const handleSettingsChange = useCallback(
    (settings: UserSettings, dirty: boolean) => {
      setCurrentSettings(settings);
      setIsDirty(dirty);
      setValidationError(null);
    },
    []
  );

  // Handle save button click - validate and show diff modal
  const handleSaveClick = useCallback(() => {
    if (!currentSettings) return;

    // Validate settings before showing diff
    const result = UserSettingsSchema.safeParse(currentSettings);
    if (!result.success) {
      const errorMessage = result.error.errors
        .map((e) => `${e.path.join('.')}: ${e.message}`)
        .join('\n');
      setValidationError(errorMessage);
      toast.error('Validation failed. Please fix errors before saving.');
      return;
    }

    setShowDiffModal(true);
  }, [currentSettings]);

  // Handle diff modal confirm
  const handleConfirmSave = useCallback(() => {
    if (!currentSettings) return;
    saveMutation.mutate(currentSettings);
  }, [currentSettings, saveMutation]);

  // Handle discard
  const handleDiscard = useCallback(() => {
    // Increment key to force SettingsSplitView remount
    splitViewKey.current += 1;
    setCurrentSettings(null);
    setIsDirty(false);
    setValidationError(null);
    toast.info('Changes discarded');
    // Refetch to ensure we have latest
    refetch();
  }, [refetch]);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Settings</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-gray-600 dark:border-gray-700 dark:border-t-gray-400" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Settings</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-md bg-red-50 p-4 text-red-700 dark:bg-red-950/50 dark:text-red-400">
            Error loading settings: {error.message}
          </div>
        </CardContent>
      </Card>
    );
  }

  const settings = data as UserSettings;

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="flex items-center gap-3">
            <CardTitle>Settings</CardTitle>
            {isDirty && (
              <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-1 rounded dark:bg-yellow-900/50 dark:text-yellow-300">
                Unsaved changes
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {isDirty && (
              <>
                <button
                  onClick={handleDiscard}
                  className="rounded-md bg-white px-3 py-1 text-sm font-medium text-gray-700 border border-gray-300 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700 dark:hover:bg-gray-700"
                >
                  Discard
                </button>
                <button
                  onClick={handleSaveClick}
                  disabled={saveMutation.isPending}
                  className="rounded-md bg-gray-900 px-3 py-1 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 dark:bg-gray-50 dark:text-gray-900 dark:hover:bg-gray-200"
                >
                  {saveMutation.isPending ? 'Saving...' : 'Save'}
                </button>
              </>
            )}
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="rounded-md bg-gray-100 px-3 py-1 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              {isFetching ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </CardHeader>
        <CardContent>
          {validationError && (
            <div className="mb-4 rounded-md bg-red-50 p-4 text-red-700 dark:bg-red-950/50 dark:text-red-400">
              <p className="font-medium">Validation Errors:</p>
              <pre className="mt-2 text-sm whitespace-pre-wrap">
                {validationError}
              </pre>
            </div>
          )}
          <SettingsSplitView
            key={splitViewKey.current}
            initialSettings={settings}
            onSettingsChange={handleSettingsChange}
          />
        </CardContent>
      </Card>

      {/* Diff Modal */}
      <SettingsDiffModal
        isOpen={showDiffModal}
        original={JSON.stringify(settings, null, 2)}
        modified={JSON.stringify(currentSettings ?? settings, null, 2)}
        onConfirm={handleConfirmSave}
        onCancel={() => setShowDiffModal(false)}
        isSaving={saveMutation.isPending}
      />
    </>
  );
}
