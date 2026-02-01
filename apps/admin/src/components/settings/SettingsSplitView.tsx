import { useState, useCallback, useRef, useEffect } from 'react';
import { useForm, Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { UserSettingsSchema, type UserSettings } from '@livermore/schemas';
import { SettingsForm } from './SettingsForm';
import { SettingsJsonEditor } from './SettingsJsonEditor';

interface SettingsSplitViewProps {
  /** Initial settings from server */
  initialSettings: UserSettings;
  /** Callback when settings change (for parent to track dirty state) */
  onSettingsChange: (settings: UserSettings, isDirty: boolean) => void;
}

// Cast resolver to avoid type mismatch between Zod input/output types
// This is a known issue with @hookform/resolvers and schemas with defaults
const settingsResolver = zodResolver(UserSettingsSchema) as Resolver<UserSettings>;

/**
 * Side-by-side form + JSON editor with bidirectional sync.
 * Form changes update JSON, JSON changes update form.
 * Satisfies UI-SET-03.
 */
export function SettingsSplitView({
  initialSettings,
  onSettingsChange,
}: SettingsSplitViewProps) {
  // JSON string state for the editor
  const [jsonValue, setJsonValue] = useState(() =>
    JSON.stringify(initialSettings, null, 2)
  );

  // Validation error for JSON editor
  const [jsonError, setJsonError] = useState<string | undefined>();

  // Track which side was last edited to prevent sync loops
  const lastEditSource = useRef<'form' | 'json' | null>(null);

  // Debounce timer ref
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Form instance with Zod validation
  const form = useForm<UserSettings>({
    resolver: settingsResolver,
    defaultValues: initialSettings,
    mode: 'onBlur',
  });

  // Compare current settings to initial to determine dirty state
  const isDirty = useCallback(
    (current: UserSettings) =>
      JSON.stringify(current) !== JSON.stringify(initialSettings),
    [initialSettings]
  );

  // Handle form value changes -> update JSON editor
  useEffect(() => {
    const subscription = form.watch((values) => {
      if (lastEditSource.current === 'json') {
        // Skip if change came from JSON editor
        lastEditSource.current = null;
        return;
      }

      // Debounce form -> JSON sync
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
      }

      syncTimeoutRef.current = setTimeout(() => {
        if (values) {
          const formValues = values as UserSettings;
          setJsonValue(JSON.stringify(formValues, null, 2));
          setJsonError(undefined);
          onSettingsChange(formValues, isDirty(formValues));
        }
      }, 300);
    });

    return () => {
      subscription.unsubscribe();
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
      }
    };
  }, [form, onSettingsChange, isDirty]);

  // Handle JSON editor changes -> update form
  const handleJsonChange = useCallback(
    (newJson: string) => {
      setJsonValue(newJson);

      try {
        const parsed = JSON.parse(newJson);
        const validated = UserSettingsSchema.parse(parsed);

        // Mark that this change came from JSON
        lastEditSource.current = 'json';

        // Reset form with validated values
        form.reset(validated, { keepDirty: false });
        setJsonError(undefined);
        onSettingsChange(validated, isDirty(validated));
      } catch (err) {
        // Show validation error in editor
        if (err instanceof Error) {
          setJsonError(err.message);
        } else {
          setJsonError('Invalid JSON');
        }
      }
    },
    [form, onSettingsChange, isDirty]
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Form Editor (Left Side) */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-gray-700">Form Editor</h3>
          <span className="text-xs text-gray-500">
            Edit fields to update settings
          </span>
        </div>
        <div className="max-h-[600px] overflow-y-auto pr-2">
          <SettingsForm form={form} defaultValues={initialSettings} />
        </div>
      </div>

      {/* JSON Editor (Right Side) */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-gray-700">JSON Editor</h3>
          <span className="text-xs text-gray-500">
            Edit raw JSON for advanced changes
          </span>
        </div>
        <SettingsJsonEditor
          value={jsonValue}
          onChange={handleJsonChange}
          validationError={jsonError}
          height="600px"
        />
      </div>
    </div>
  );
}
