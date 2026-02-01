# Phase 21: Admin UI - Settings - Research

**Researched:** 2026-02-01
**Domain:** React form UI, JSON editing, settings management
**Confidence:** HIGH

## Summary

This phase builds a Settings page for the admin app that lets users view and edit their settings through both form-based and JSON interfaces. The existing infrastructure includes a complete settings router (settings.get, settings.update, settings.patch, settings.export, settings.import) and a well-defined UserSettings Zod schema with nested objects for profile, exchanges, runtime config, and symbols.

The standard approach uses:
- **React Hook Form + Zod** for form-based editing (already the shadcn/ui pattern)
- **@monaco-editor/react** for JSON editing with DiffEditor for showing changes
- **Sonner** for toast notifications (shadcn/ui recommended)
- **Controlled state synchronization** between form and JSON views

**Primary recommendation:** Use Monaco DiffEditor for the settings diff view (requirement UI-SET-04) rather than a separate diff library, as it provides built-in side-by-side comparison and is already needed for JSON editing.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| react-hook-form | ^7.x | Form state management | shadcn/ui official recommendation |
| @hookform/resolvers | ^3.x | Zod integration | Connects Zod schemas to RHF |
| zod | (existing) | Schema validation | Already in codebase for UserSettingsSchema |
| @monaco-editor/react | ^4.7 (latest supports React 19) | JSON/code editing | Works with Vite without config, has DiffEditor |
| sonner | ^1.7 | Toast notifications | shadcn/ui official replacement for toast |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @tanstack/react-query | (existing) | Server state | Already in admin app |
| lucide-react | (existing) | Icons | Already in admin app |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| @monaco-editor/react | json-edit-react | json-edit-react is simpler for tree-view editing, but Monaco provides code-level editing + built-in diff |
| Monaco DiffEditor | react-diff-viewer | react-diff-viewer is text-only; Monaco understands JSON structure |
| sonner | react-hot-toast | sonner is shadcn/ui official, has promise() for async operations |

**Installation:**
```bash
pnpm add react-hook-form @hookform/resolvers @monaco-editor/react sonner
pnpm dlx shadcn@latest add sonner input switch form field
```

## Architecture Patterns

### Recommended Component Structure
```
apps/admin/src/
├── pages/
│   └── Settings.tsx           # Main settings page
├── components/
│   ├── ui/
│   │   ├── sonner.tsx         # Toaster component (via shadcn)
│   │   ├── input.tsx          # Form input (via shadcn)
│   │   ├── switch.tsx         # Toggle switch (via shadcn)
│   │   ├── field.tsx          # Field wrapper (via shadcn)
│   │   └── form.tsx           # Form components (via shadcn)
│   └── settings/
│       ├── SettingsForm.tsx       # Form-based editor
│       ├── SettingsJsonEditor.tsx # Monaco JSON editor
│       ├── SettingsDiffView.tsx   # Monaco DiffEditor wrapper
│       ├── SettingsSplitView.tsx  # Side-by-side layout
│       └── sections/
│           ├── ProfileSection.tsx     # perseus_profile fields
│           ├── ExchangeSection.tsx    # exchanges config
│           ├── RuntimeSection.tsx     # livermore_runtime fields
│           └── SymbolsSection.tsx     # symbols array
```

### Pattern 1: Bidirectional Form-JSON Sync
**What:** Keep form state and JSON state synchronized without infinite loops
**When to use:** Side-by-side form + JSON view (UI-SET-03)
**Example:**
```typescript
// Source: React controlled component pattern
function SettingsSplitView() {
  // Single source of truth
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [pendingChanges, setPendingChanges] = useState<UserSettings | null>(null);

  // Form uses react-hook-form with settings as defaultValues
  const form = useForm<UserSettings>({
    resolver: zodResolver(UserSettingsSchema),
    defaultValues: settings ?? undefined,
  });

  // Sync form changes to pending state
  const onFormChange = (data: UserSettings) => {
    setPendingChanges(data);
  };

  // Sync JSON changes to form
  const onJsonChange = (json: string) => {
    try {
      const parsed = JSON.parse(json);
      const validated = UserSettingsSchema.parse(parsed);
      form.reset(validated);
      setPendingChanges(validated);
    } catch (e) {
      // Show validation error in JSON editor
    }
  };

  // Original settings for diff comparison
  const hasChanges = JSON.stringify(settings) !== JSON.stringify(pendingChanges);
}
```

### Pattern 2: Section-Based Form Organization
**What:** Break settings schema into logical form sections
**When to use:** Complex settings objects like UserSettings
**Example:**
```typescript
// Source: shadcn/ui form patterns
// UserSettingsSchema has: perseus_profile, livermore_runtime, exchanges, symbols
// Map each to a collapsible form section

function SettingsForm({ form }: { form: UseFormReturn<UserSettings> }) {
  return (
    <Form {...form}>
      <ProfileSection form={form} />     {/* perseus_profile fields */}
      <RuntimeSection form={form} />     {/* livermore_runtime fields */}
      <ExchangesSection form={form} />   {/* exchanges record - dynamic */}
      <SymbolsSection form={form} />     {/* symbols array */}
    </Form>
  );
}

// Each section uses Controller + Field pattern
function ProfileSection({ form }: { form: UseFormReturn<UserSettings> }) {
  return (
    <Card>
      <CardHeader><CardTitle>Profile</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <Controller
          name="perseus_profile.public_name"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel>Display Name</FieldLabel>
              <Input {...field} />
              <FieldError errors={[fieldState.error]} />
            </Field>
          )}
        />
        {/* More fields... */}
      </CardContent>
    </Card>
  );
}
```

### Pattern 3: Optimistic Updates with Rollback
**What:** Show immediate UI feedback, rollback on server error
**When to use:** Save operations with toast notifications
**Example:**
```typescript
// Source: TanStack Query mutation pattern + sonner
import { toast } from 'sonner';
import { useMutation, useQueryClient } from '@tanstack/react-query';

function useSettingsMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: UserSettings) => trpcClient.settings.update.mutate(data),
    onMutate: async (newSettings) => {
      // Cancel in-flight queries
      await queryClient.cancelQueries({ queryKey: ['settings'] });
      // Snapshot previous value
      const previous = queryClient.getQueryData(['settings']);
      // Optimistically update
      queryClient.setQueryData(['settings'], newSettings);
      return { previous };
    },
    onSuccess: () => {
      toast.success('Settings saved successfully');
    },
    onError: (err, newSettings, context) => {
      // Rollback
      queryClient.setQueryData(['settings'], context?.previous);
      toast.error(`Failed to save: ${err.message}`);
    },
  });
}
```

### Anti-Patterns to Avoid
- **Direct two-way binding between form and editor:** Causes infinite update loops. Use a single source of truth with explicit sync functions.
- **Validating JSON on every keystroke:** Use debounced validation or validate on blur/submit only.
- **Storing settings in multiple states:** Keep one authoritative copy, derive views from it.
- **Giant monolithic form component:** Break into sections matching schema structure.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSON syntax highlighting | Custom textarea | Monaco Editor | Syntax errors, formatting, themes |
| JSON diff visualization | Custom diff logic | Monaco DiffEditor | Side-by-side, inline, word-level diffs |
| Form validation | Manual if/else | Zod + react-hook-form | Type safety, nested validation, error messages |
| Toast notifications | Custom portal | Sonner | Stacking, animations, promise support |
| Deep object comparison | Manual recursion | JSON.stringify or lodash.isEqual | Edge cases with undefined, order |

**Key insight:** The settings UI combines form editing and JSON editing - both well-solved domains. The challenge is synchronization, not building either from scratch.

## Common Pitfalls

### Pitfall 1: Monaco Editor Bundle Size
**What goes wrong:** Monaco adds ~2MB to bundle, slow initial load
**Why it happens:** Monaco includes all languages by default
**How to avoid:**
- Use `@monaco-editor/react` which lazy-loads Monaco from CDN by default
- For production, consider configuring Monaco's webpack plugin if bundle size is critical
- Accept the tradeoff: Monaco's features justify the size for a settings page
**Warning signs:** First load takes >3 seconds on fast connection

### Pitfall 2: React 19 Compatibility
**What goes wrong:** Some packages have peer dependency warnings with React 19
**Why it happens:** Ecosystem still catching up to React 19
**How to avoid:**
- Use `@monaco-editor/react@next` for React 19 support (or latest if 4.7+ is current)
- Check package.json for `"react": "^19.0.0"` peer support
**Warning signs:** Console warnings about peer dependencies during install

### Pitfall 3: Form/JSON Sync Race Conditions
**What goes wrong:** User types in form while JSON is updating, loses changes
**Why it happens:** Bidirectional sync without proper coordination
**How to avoid:**
- Debounce form->JSON sync (300ms typical)
- Lock form while JSON is being edited (and vice versa)
- Use "dirty" tracking to warn before switching modes
**Warning signs:** User reports losing typed content

### Pitfall 4: Zod Validation Timing
**What goes wrong:** Validation errors appear on empty form, poor UX
**Why it happens:** Default `mode: 'all'` validates immediately
**How to avoid:** Use `mode: 'onBlur'` for text fields, `mode: 'onSubmit'` for overall form
**Warning signs:** Red error states before user has typed anything

### Pitfall 5: Nested Object Default Values
**What goes wrong:** Form crashes or shows undefined for nested optional fields
**Why it happens:** `perseus_profile.timezone` is undefined when `perseus_profile` is undefined
**How to avoid:**
- Provide complete default values including all nested paths
- Use optional chaining in form field access
- Initialize missing objects on load: `settings.perseus_profile ?? {}`
**Warning signs:** "Cannot read property of undefined" errors

## Code Examples

Verified patterns from official sources:

### Monaco Editor Setup
```typescript
// Source: @monaco-editor/react documentation
import Editor from '@monaco-editor/react';

function SettingsJsonEditor({
  value,
  onChange,
  readOnly = false
}: {
  value: string;
  onChange: (value: string | undefined) => void;
  readOnly?: boolean;
}) {
  return (
    <Editor
      height="400px"
      language="json"
      value={value}
      onChange={onChange}
      options={{
        readOnly,
        minimap: { enabled: false },
        lineNumbers: 'on',
        scrollBeyondLastLine: false,
        formatOnPaste: true,
        formatOnType: true,
      }}
      theme="vs-dark"
    />
  );
}
```

### Monaco DiffEditor for Settings Diff
```typescript
// Source: @monaco-editor/react DiffEditor documentation
import { DiffEditor } from '@monaco-editor/react';

function SettingsDiffView({
  original,
  modified
}: {
  original: string;
  modified: string;
}) {
  return (
    <DiffEditor
      height="400px"
      language="json"
      original={original}
      modified={modified}
      options={{
        readOnly: true,
        renderSideBySide: true,
        enableSplitViewResizing: true,
        ignoreTrimWhitespace: false,
      }}
      theme="vs-dark"
    />
  );
}
```

### Sonner Toast Setup
```typescript
// Source: shadcn/ui sonner documentation
// In main.tsx or App.tsx
import { Toaster } from '@/components/ui/sonner';

function App() {
  return (
    <>
      {/* Your app content */}
      <Toaster />
    </>
  );
}

// Usage in components
import { toast } from 'sonner';

// Success
toast.success('Settings saved');

// Error
toast.error('Failed to save settings');

// Promise (for async operations)
toast.promise(saveSettings(), {
  loading: 'Saving...',
  success: 'Settings saved!',
  error: (err) => `Error: ${err.message}`,
});
```

### Form with Zod Validation
```typescript
// Source: shadcn/ui react-hook-form documentation
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { UserSettingsSchema, type UserSettings } from '@livermore/schemas';

function SettingsForm({
  defaultValues,
  onSubmit
}: {
  defaultValues: UserSettings;
  onSubmit: (data: UserSettings) => void;
}) {
  const form = useForm<UserSettings>({
    resolver: zodResolver(UserSettingsSchema),
    defaultValues,
    mode: 'onBlur', // Validate on blur, not on every keystroke
  });

  return (
    <form onSubmit={form.handleSubmit(onSubmit)}>
      <Controller
        name="perseus_profile.timezone"
        control={form.control}
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid}>
            <FieldLabel htmlFor="timezone">Timezone</FieldLabel>
            <Input
              id="timezone"
              {...field}
              value={field.value ?? ''}
              aria-invalid={fieldState.invalid}
            />
            {fieldState.error && (
              <FieldError errors={[fieldState.error]} />
            )}
          </Field>
        )}
      />
      {/* More fields */}
    </form>
  );
}
```

### Loading and Error States
```typescript
// Source: Existing Dashboard.tsx pattern in codebase
import { useQuery } from '@tanstack/react-query';
import { trpc } from '@/lib/trpc';

function Settings() {
  const { data, isLoading, error, refetch } = useQuery(
    trpc.settings.get.queryOptions()
  );

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-gray-600" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent>
          <div className="rounded-md bg-red-50 p-4 text-red-700">
            Error loading settings: {error.message}
          </div>
        </CardContent>
      </Card>
    );
  }

  return <SettingsEditor settings={data} />;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| shadcn toast | Sonner | 2024 | Toast component deprecated |
| Form component | Field component | Late 2024 | More flexibility, less abstraction |
| Monaco webpack config | @monaco-editor/react CDN | 2022+ | Zero config for Vite/CRA |
| Manual form state | react-hook-form | Ongoing | Better performance, less rerenders |

**Deprecated/outdated:**
- **shadcn/ui Toast component:** Replaced by Sonner, see [Sonner docs](https://ui.shadcn.com/docs/components/sonner)
- **Form abstraction component:** shadcn recommends Field component pattern instead

## Open Questions

Things that couldn't be fully resolved:

1. **Bundle size optimization for Monaco**
   - What we know: Monaco adds ~2MB, @monaco-editor/react lazy-loads from CDN
   - What's unclear: Whether self-hosting Monaco workers improves or hurts performance
   - Recommendation: Use CDN default first, optimize only if metrics show issues

2. **Exact React 19 compatibility for Monaco**
   - What we know: `@monaco-editor/react@next` tag supports React 19
   - What's unclear: Current stable version compatibility (docs lag releases)
   - Recommendation: Try stable first, fall back to @next if peer dep warnings

3. **Form field generation from Zod schema**
   - What we know: Libraries like zod-to-fields exist for auto-generation
   - What's unclear: Whether auto-generation is worth complexity vs manual mapping
   - Recommendation: Manual mapping for now (schema is small), revisit if schema grows

## Sources

### Primary (HIGH confidence)
- [shadcn/ui Sonner docs](https://ui.shadcn.com/docs/components/sonner) - Toast installation and usage
- [shadcn/ui Form docs](https://ui.shadcn.com/docs/components/form) - Form component structure
- [shadcn/ui React Hook Form docs](https://ui.shadcn.com/docs/forms/react-hook-form) - RHF integration patterns
- [@monaco-editor/react GitHub](https://github.com/suren-atoyan/monaco-react) - Editor and DiffEditor usage
- [json-edit-react GitHub](https://github.com/CarlosNZ/json-edit-react) - Alternative JSON editor (not recommended but documented)

### Secondary (MEDIUM confidence)
- [npm @monaco-editor/react](https://www.npmjs.com/package/@monaco-editor/react) - Version and peer dependencies
- WebSearch results for React 19 + Monaco compatibility
- WebSearch results for form/JSON bidirectional sync patterns

### Tertiary (LOW confidence)
- WebSearch results for zod-to-fields automatic form generation (not verified with official docs)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - shadcn/ui officially recommends these libraries
- Architecture: HIGH - patterns from official docs and existing codebase
- Pitfalls: MEDIUM - based on common issues, not verified in this specific context

**Research date:** 2026-02-01
**Valid until:** 2026-03-01 (30 days - libraries are stable)
