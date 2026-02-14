import { useEffect, useState } from 'react';
import { Toaster as Sonner } from 'sonner';

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const el = document.documentElement;
    const update = () => setTheme(el.classList.contains('dark') ? 'dark' : 'light');
    update();
    const observer = new MutationObserver(update);
    observer.observe(el, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      position="top-right"
      expand={true}
      visibleToasts={5}
      gap={8}
      toastOptions={{
        classNames: {
          toast:
            'group toast group-[.toaster]:bg-white group-[.toaster]:text-gray-950 group-[.toaster]:border-gray-200 group-[.toaster]:shadow-lg dark:group-[.toaster]:backdrop-blur-xl dark:group-[.toaster]:bg-gray-950/60 dark:group-[.toaster]:text-gray-50 dark:group-[.toaster]:border-white/10 dark:group-[.toaster]:shadow-xl',
          description: 'group-[.toast]:text-gray-500 dark:group-[.toast]:text-gray-300',
          actionButton:
            'group-[.toast]:bg-gray-900 group-[.toast]:text-gray-50 dark:group-[.toast]:bg-white/15 dark:group-[.toast]:text-gray-50 dark:group-[.toast]:backdrop-blur-sm',
          cancelButton:
            'group-[.toast]:bg-gray-100 group-[.toast]:text-gray-500 dark:group-[.toast]:bg-white/10 dark:group-[.toast]:text-gray-400',
          success:
            'dark:group-[.toaster]:!bg-emerald-500/12 dark:group-[.toaster]:!border-emerald-500/25 dark:group-[.toaster]:!shadow-[0_0_20px_rgba(16,185,129,0.1),inset_0_1px_0_rgba(255,255,255,0.05)]',
          error:
            'dark:group-[.toaster]:!bg-red-500/12 dark:group-[.toaster]:!border-red-500/25 dark:group-[.toaster]:!shadow-[0_0_20px_rgba(239,68,68,0.1),inset_0_1px_0_rgba(255,255,255,0.05)]',
          info:
            'dark:group-[.toaster]:!bg-blue-500/12 dark:group-[.toaster]:!border-blue-500/25 dark:group-[.toaster]:!shadow-[0_0_20px_rgba(59,130,246,0.1),inset_0_1px_0_rgba(255,255,255,0.05)]',
          warning:
            'dark:group-[.toaster]:!bg-amber-500/12 dark:group-[.toaster]:!border-amber-500/25 dark:group-[.toaster]:!shadow-[0_0_20px_rgba(245,158,11,0.1),inset_0_1px_0_rgba(255,255,255,0.05)]',
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
