'use client';

import { Toaster as SonnerToaster, toast } from 'sonner';

export function Toaster() {
  return (
    <SonnerToaster
      theme="dark"
      position="top-right"
      richColors={false}
      closeButton
      toastOptions={{
        style: {
          background: '#18181b',
          border: '1px solid #27272a',
          color: '#fafafa',
          fontFamily: 'var(--font-inter), ui-sans-serif, system-ui, sans-serif',
          fontSize: '13px',
        },
        classNames: {
          success: '!border-emerald-500/40',
          error: '!border-rose-500/40',
          warning: '!border-amber-500/40',
        },
      }}
    />
  );
}

export { toast };
