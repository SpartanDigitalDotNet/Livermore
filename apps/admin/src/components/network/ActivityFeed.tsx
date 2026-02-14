import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Activity, CheckCircle, AlertTriangle } from 'lucide-react';

interface ActivityFeedProps {
  entries: Array<Record<string, string> & { id: string }>;
  exchanges?: string[];
  isLoading?: boolean;
}

/**
 * Format a Redis stream ID timestamp to relative time.
 * Stream IDs have the format "timestamp-sequence".
 */
function formatRelativeTime(streamId: string): string {
  const ms = parseInt(streamId.split('-')[0], 10);
  if (isNaN(ms)) return '';

  const seconds = Math.floor((Date.now() - ms) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return new Date(ms).toLocaleDateString();
}

/**
 * Format a Redis stream ID timestamp to a local time string.
 * Shows "2:47 PM" for today, "Feb 10, 2:47 PM" for older dates.
 */
function formatLocalTime(streamId: string): string {
  const ms = parseInt(streamId.split('-')[0], 10);
  if (isNaN(ms)) return '';

  const date = new Date(ms);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  if (isToday) {
    return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ', ' + date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/**
 * Format a Redis stream ID timestamp as UTC for tooltip display.
 */
function formatUTCTime(streamId: string): string {
  const ms = parseInt(streamId.split('-')[0], 10);
  if (isNaN(ms)) return '';
  return new Date(ms).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
}

const ALL = '__all__';

/**
 * ActivityFeed Component
 *
 * Scrollable feed of network activity (state transitions and errors)
 * in reverse chronological order. Supports filtering by exchange and user,
 * and displays local-timezone timestamps with UTC available on hover.
 */
export function ActivityFeed({ entries, exchanges = [], isLoading }: ActivityFeedProps) {
  const [exchangeFilter, setExchangeFilter] = useState(ALL);
  const [userFilter, setUserFilter] = useState(ALL);
  const [showUTC, setShowUTC] = useState(false);

  // Derive unique exchange names from both the exchanges prop and entries
  const exchangeOptions = useMemo(() => {
    const fromEntries = entries.map((e) => e.exchangeName).filter(Boolean);
    const combined = new Set([...exchanges, ...fromEntries]);
    return Array.from(combined).sort();
  }, [entries, exchanges]);

  // Derive unique user emails from entries
  const userOptions = useMemo(() => {
    const emails = entries.map((e) => e.adminEmail).filter(Boolean);
    return Array.from(new Set(emails)).sort();
  }, [entries]);

  // Apply client-side filters
  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => {
      if (exchangeFilter !== ALL && entry.exchangeName !== exchangeFilter) return false;
      if (userFilter !== ALL && entry.adminEmail !== userFilter) return false;
      return true;
    });
  }, [entries, exchangeFilter, userFilter]);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3">
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Activity Feed
          </CardTitle>

          {/* Filter controls */}
          <div className="flex flex-wrap items-center gap-3">
            <Select value={exchangeFilter} onValueChange={setExchangeFilter}>
              <SelectTrigger className="w-40 h-8 text-xs">
                <SelectValue placeholder="All Exchanges" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All Exchanges</SelectItem>
                {exchangeOptions.map((name) => (
                  <SelectItem key={name} value={name}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={userFilter} onValueChange={setUserFilter}>
              <SelectTrigger className="w-44 h-8 text-xs">
                <SelectValue placeholder="All Users" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All Users</SelectItem>
                {userOptions.map((email) => (
                  <SelectItem key={email} value={email}>{email}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex items-center gap-1.5">
              <Switch
                id="utc-toggle"
                checked={showUTC}
                onCheckedChange={setShowUTC}
                className="scale-75"
              />
              <Label htmlFor="utc-toggle" className="text-xs text-gray-500 cursor-pointer dark:text-gray-400">
                UTC
              </Label>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-gray-600 dark:border-gray-700 dark:border-t-gray-400" />
          </div>
        ) : filteredEntries.length === 0 ? (
          <p className="text-gray-500 text-sm dark:text-gray-400">
            {entries.length === 0 ? 'No recent activity' : 'No matching activity'}
          </p>
        ) : (
          <TooltipProvider>
            <div className="max-h-96 overflow-y-auto space-y-2">
              {filteredEntries.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-start gap-3 border rounded-lg p-3 dark:border-gray-800"
                >
                  {/* Icon */}
                  {entry.event === 'error' ? (
                    <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                  ) : (
                    <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                  )}

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    {entry.event === 'state_transition' ? (
                      <>
                        <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                          {entry.exchangeName}:{' '}
                          <span className="text-gray-500 dark:text-gray-400">{entry.fromState}</span>
                          <span className="mx-1 text-gray-400 dark:text-gray-500">&rarr;</span>
                          <span className="text-gray-700 dark:text-gray-300">{entry.toState}</span>
                        </div>
                        <div className="text-xs text-gray-500 truncate dark:text-gray-400">
                          {entry.adminEmail || entry.hostname}
                        </div>
                      </>
                    ) : entry.event === 'error' ? (
                      <>
                        <div className="text-sm font-medium text-red-700 dark:text-red-400">
                          {entry.exchangeName}: {entry.error}
                        </div>
                        <div className="text-xs text-gray-500 truncate dark:text-gray-400">
                          {entry.hostname}
                        </div>
                      </>
                    ) : (
                      <div className="text-sm text-gray-700 dark:text-gray-300">
                        {entry.exchangeName}: {entry.event}
                      </div>
                    )}
                  </div>

                  {/* Timestamp */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="text-right shrink-0">
                        <div className="text-xs text-gray-400 whitespace-nowrap dark:text-gray-500">
                          {formatRelativeTime(entry.id)}
                        </div>
                        <div className="text-xs text-gray-400 whitespace-nowrap dark:text-gray-500">
                          {showUTC ? formatUTCTime(entry.id) : formatLocalTime(entry.id)}
                        </div>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs">{formatUTCTime(entry.id)}</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
              ))}
            </div>
          </TooltipProvider>
        )}
      </CardContent>
    </Card>
  );
}
