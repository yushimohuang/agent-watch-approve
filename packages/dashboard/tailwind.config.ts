import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // 语义色：审批状态
        approved: {
          DEFAULT: '#10b981', // emerald-500
          fg: '#ecfdf5',
        },
        denied: {
          DEFAULT: '#f43f5e', // rose-500
          fg: '#fff1f2',
        },
        pending: {
          DEFAULT: '#f59e0b', // amber-500
          fg: '#fffbeb',
        },
        // 复用 shadcn 习惯的 token 名称（指向 zinc 调色板）
        border: 'rgb(63 63 70)', // zinc-800
        input: 'rgb(63 63 70)',
        ring: '#f59e0b',
        background: '#09090b', // zinc-950
        foreground: '#fafafa', // zinc-50
        primary: {
          DEFAULT: '#f59e0b', // amber-500
          foreground: '#1c1917',
        },
        secondary: {
          DEFAULT: '#27272a', // zinc-800
          foreground: '#fafafa',
        },
        muted: {
          DEFAULT: '#27272a',
          foreground: '#a1a1aa', // zinc-400
        },
        destructive: {
          DEFAULT: '#f43f5e',
          foreground: '#fafafa',
        },
        card: {
          DEFAULT: '#18181b', // zinc-900
          foreground: '#fafafa',
        },
        popover: {
          DEFAULT: '#18181b',
          foreground: '#fafafa',
        },
        accent: {
          DEFAULT: '#f59e0b',
          foreground: '#1c1917',
        },
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-jetbrains)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      borderRadius: {
        xl: '0.875rem',
      },
      keyframes: {
        'fade-in-50': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'pulse-dot': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.4' },
        },
      },
      animation: {
        'fade-in-50': 'fade-in-50 0.3s ease-out',
        'pulse-dot': 'pulse-dot 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
