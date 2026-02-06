import { useForm, Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { UserSettingsSchema, type UserSettings } from '@livermore/schemas';

// Cast resolver to avoid type mismatch between Zod input/output types
// This is a known issue with @hookform/resolvers and schemas with defaults
export const settingsResolver = zodResolver(UserSettingsSchema) as Resolver<UserSettings>;

/**
 * Hook to create a shared form instance for external control.
 * Use this when you need to control the form from a parent component.
 */
export function useSettingsForm(defaultValues: UserSettings) {
  return useForm<UserSettings>({
    resolver: settingsResolver,
    defaultValues,
    mode: 'onBlur',
  });
}
