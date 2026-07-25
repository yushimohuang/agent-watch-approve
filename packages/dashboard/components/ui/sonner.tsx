'use client';

import { Toaster as SonnerToaster, toast } from 'sonner';

export function Toaster() {
  return (
    <SonnerToaster
      theme="light"
      position="top-right"
      richColors={false}
      closeButton
      toastOptions={{
        style: {
          background: '#ffffff',
          border: '1px solid #e4e4e7',
          color: '#18181b',
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
