import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SettingsSplitView } from '@/components/settings';
import type { UserSettings } from '@livermore/schemas';

export function Settings() {
  const { data, isLoading, error, refetch, isFetching } = useQuery(
    trpc.settings.get.queryOptions()
  );

  // Track current settings and dirty state
  // Note: currentSettings will be used in Plan 05 for save functionality
  const [_currentSettings, setCurrentSettings] = useState<UserSettings | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  // Handle settings changes from split view
  const handleSettingsChange = useCallback(
    (settings: UserSettings, dirty: boolean) => {
      setCurrentSettings(settings);
      setIsDirty(dirty);
    },
    []
  );

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Settings</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-gray-600" />
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
          <div className="rounded-md bg-red-50 p-4 text-red-700">
            Error loading settings: {error.message}
          </div>
        </CardContent>
      </Card>
    );
  }

  const settings = data as UserSettings;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex items-center gap-3">
          <CardTitle>Settings</CardTitle>
          {isDirty && (
            <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-1 rounded">
              Unsaved changes
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="rounded-md bg-gray-100 px-3 py-1 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50"
          >
            {isFetching ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </CardHeader>
      <CardContent>
        <SettingsSplitView
          initialSettings={settings}
          onSettingsChange={handleSettingsChange}
        />
      </CardContent>
    </Card>
  );
}
