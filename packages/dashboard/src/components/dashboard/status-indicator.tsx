'use client';

import { cn } from '@/lib/utils';
import { Wifi, WifiOff } from 'lucide-react';

interface StatusIndicatorProps {
  connected: boolean;
  className?: string;
}

export function StatusIndicator({ connected, className }: StatusIndicatorProps) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      {connected ? (
        <>
          <Wifi className="w-4 h-4 text-green-500" />
          <span className="text-sm text-green-600 dark:text-green-400">Connected</span>
        </>
      ) : (
        <>
          <WifiOff className="w-4 h-4 text-red-500" />
          <span className="text-sm text-red-600 dark:text-red-400">Disconnected</span>
        </>
      )}
    </div>
  );
}
