import { useForm, UseFormReturn, Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { UserSettingsSchema, type UserSettings } from '@livermore/schemas';
import { ProfileSection } from './ProfileSection';
import { RuntimeSection } from './RuntimeSection';

interface SettingsFormProps {
  /** Initial settings values */
  defaultValues: UserSettings;
  /** Callback when form values change (for sync with JSON editor) */
  onValuesChange?: (values: UserSettings) => void;
  /** External form instance (optional, for controlled mode) */
  form?: UseFormReturn<UserSettings>;
}

// Cast resolver to avoid type mismatch between Zod input/output types
// This is a known issue with @hookform/resolvers and schemas with defaults
const settingsResolver = zodResolver(UserSettingsSchema) as Resolver<UserSettings>;

/**
 * Complete settings form with all section components.
 * Can be used standalone or controlled externally via form prop.
 * Satisfies UI-SET-01.
 */
export function SettingsForm({
  defaultValues,
  onValuesChange,
  form: externalForm,
}: SettingsFormProps) {
  // Use external form if provided, otherwise create internal form
  const internalForm = useForm<UserSettings>({
    resolver: settingsResolver,
    defaultValues,
    mode: 'onBlur',
  });

  const form = externalForm ?? internalForm;

  // Subscribe to form changes if callback provided
  if (onValuesChange) {
    form.watch((values) => {
      // Only fire if we have valid values
      if (values) {
        onValuesChange(values as UserSettings);
      }
    });
  }

  return (
    <div className="space-y-6">
      <ProfileSection form={form} />
      <RuntimeSection form={form} />
    </div>
  );
}

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
