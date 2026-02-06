import { useForm, UseFormReturn } from 'react-hook-form';
import { type UserSettings } from '@livermore/schemas';
import { ProfileSection } from './ProfileSection';
import { RuntimeSection } from './RuntimeSection';
import { settingsResolver } from './useSettingsForm';

interface SettingsFormProps {
  /** Initial settings values */
  defaultValues: UserSettings;
  /** Callback when form values change (for sync with JSON editor) */
  onValuesChange?: (values: UserSettings) => void;
  /** External form instance (optional, for controlled mode) */
  form?: UseFormReturn<UserSettings>;
}

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
