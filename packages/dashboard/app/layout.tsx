import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/lib/auth-context';
import { Sidebar } from '@/components/sidebar';
import { Topbar } from '@/components/topbar';
import { Toaster } from '@/components/ui/sonner';
import { LoginGate } from '@/components/login-gate';
import { AppShell } from '@/components/app-shell';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Agent Watch Approve · 审批控制台',
  description: 'AI Agent 远程控制与监控 · 审批网关控制台',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" className={`${inter.variable} ${jetbrains.variable}`}>
      <body className="min-h-screen bg-zinc-50 text-zinc-900 antialiased">
        <AuthProvider>
          <AppShell
            sidebar={<Sidebar />}
            topbar={<Topbar />}
            loginGate={<LoginGate />}
          >
            {children}
          </AppShell>
        </AuthProvider>
        <Toaster />
      </body>
    </html>
  );
}
