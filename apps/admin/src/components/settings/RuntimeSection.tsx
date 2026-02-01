import { Controller, UseFormReturn } from 'react-hook-form';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { UserSettings } from '@livermore/schemas';

interface RuntimeSectionProps {
  form: UseFormReturn<UserSettings>;
}

/**
 * Form section for livermore_runtime settings.
 * Displays auto_start toggle and logging configuration.
 */
export function RuntimeSection({ form }: RuntimeSectionProps) {
  const { control } = form;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Runtime Configuration</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Controller
          name="livermore_runtime.auto_start"
          control={control}
          render={({ field }) => (
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="auto_start">Auto Start</Label>
                <p className="text-sm text-gray-500">
                  Automatically start data collection on service startup
                </p>
              </div>
              <Switch
                id="auto_start"
                checked={field.value ?? false}
                onCheckedChange={field.onChange}
              />
            </div>
          )}
        />

        <Controller
          name="livermore_runtime.logging.verbosity_level"
          control={control}
          render={({ field }) => (
            <div className="space-y-2">
              <Label htmlFor="verbosity_level">Log Level</Label>
              <select
                id="verbosity_level"
                className="flex h-10 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-950"
                {...field}
                value={field.value ?? 'error'}
              >
                <option value="error">Error</option>
                <option value="warn">Warning</option>
                <option value="info">Info</option>
                <option value="debug">Debug</option>
              </select>
            </div>
          )}
        />

        <Controller
          name="livermore_runtime.logging.data_directory"
          control={control}
          render={({ field }) => (
            <div className="space-y-2">
              <Label htmlFor="data_directory">Data Directory</Label>
              <Input
                id="data_directory"
                placeholder="/var/data/livermore"
                {...field}
                value={field.value ?? ''}
              />
            </div>
          )}
        />
      </CardContent>
    </Card>
  );
}
