import { Controller, UseFormReturn } from 'react-hook-form';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { UserSettings } from '@livermore/schemas';

interface ProfileSectionProps {
  form: UseFormReturn<UserSettings>;
}

/**
 * Form section for perseus_profile settings.
 * Displays fields for display name, primary exchange, trading mode, timezone, etc.
 */
export function ProfileSection({ form }: ProfileSectionProps) {
  const { control, formState: { errors } } = form;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Profile</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Controller
          name="perseus_profile.public_name"
          control={control}
          render={({ field }) => (
            <div className="space-y-2">
              <Label htmlFor="public_name">Display Name</Label>
              <Input
                id="public_name"
                placeholder="My Trading Profile"
                {...field}
                value={field.value ?? ''}
              />
              {errors.perseus_profile?.public_name && (
                <p className="text-sm text-red-600">
                  {errors.perseus_profile.public_name.message}
                </p>
              )}
            </div>
          )}
        />

        <Controller
          name="perseus_profile.primary_exchange"
          control={control}
          render={({ field }) => (
            <div className="space-y-2">
              <Label htmlFor="primary_exchange">Primary Exchange</Label>
              <Input
                id="primary_exchange"
                placeholder="coinbase"
                {...field}
                value={field.value ?? ''}
              />
              {errors.perseus_profile?.primary_exchange && (
                <p className="text-sm text-red-600">
                  {errors.perseus_profile.primary_exchange.message}
                </p>
              )}
            </div>
          )}
        />

        <Controller
          name="perseus_profile.trading_mode"
          control={control}
          render={({ field }) => (
            <div className="space-y-2">
              <Label htmlFor="trading_mode">Trading Mode</Label>
              <select
                id="trading_mode"
                className="flex h-10 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-950"
                {...field}
                value={field.value ?? 'paper'}
              >
                <option value="paper">Paper (Simulated)</option>
                <option value="live">Live (Real Money)</option>
              </select>
              {errors.perseus_profile?.trading_mode && (
                <p className="text-sm text-red-600">
                  {errors.perseus_profile.trading_mode.message}
                </p>
              )}
            </div>
          )}
        />

        <Controller
          name="perseus_profile.timezone"
          control={control}
          render={({ field }) => (
            <div className="space-y-2">
              <Label htmlFor="timezone">Timezone</Label>
              <Input
                id="timezone"
                placeholder="America/New_York"
                {...field}
                value={field.value ?? 'UTC'}
              />
              {errors.perseus_profile?.timezone && (
                <p className="text-sm text-red-600">
                  {errors.perseus_profile.timezone.message}
                </p>
              )}
            </div>
          )}
        />

        <Controller
          name="perseus_profile.currency"
          control={control}
          render={({ field }) => (
            <div className="space-y-2">
              <Label htmlFor="currency">Base Currency</Label>
              <Input
                id="currency"
                placeholder="USD"
                {...field}
                value={field.value ?? 'USD'}
              />
            </div>
          )}
        />
      </CardContent>
    </Card>
  );
}
