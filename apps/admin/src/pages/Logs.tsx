import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { LogViewer, type LogEntry } from '@/components/logs/LogViewer';

type LogLevel = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';

const LEVEL_OPTIONS = [
  { value: 'WARN', label: 'Errors & Warnings' },
  { value: 'ERROR', label: 'Errors Only' },
  { value: 'INFO', label: 'Info & Above' },
  { value: 'DEBUG', label: 'All (Debug)' },
];

export function Logs() {
  const [level, setLevel] = useState<LogLevel>('WARN');

  const { data, isLoading, error, refetch, isFetching } = useQuery(
    trpc.logs.getRecent.queryOptions({ level, limit: 100 })
  );

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Logs</CardTitle>
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
          <CardTitle>Logs</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-md bg-red-50 p-4 text-red-700 dark:bg-red-950/50 dark:text-red-400">
            Error: {error.message}
          </div>
        </CardContent>
      </Card>
    );
  }

  const entries: LogEntry[] = (data?.data ?? []) as LogEntry[];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Logs</CardTitle>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {data?.date} - {data?.count} of {data?.total} entries
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={level} onValueChange={(value) => setLevel(value as LogLevel)}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LEVEL_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="rounded-md bg-gray-100 px-3 py-1 text-sm font-medium text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 disabled:opacity-50"
          >
            {isFetching ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </CardHeader>
      <CardContent>
        <LogViewer entries={entries} />
      </CardContent>
    </Card>
  );
}
