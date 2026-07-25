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
        // 语义色：审批状态（亮色版本 — DEFAULT 是底色，fg 是文字色）
        approved: {
          DEFAULT: '#10b981', // emerald-500
          fg: '#065f46', // emerald-800（亮色背景上文字够深）
        },
        denied: {
          DEFAULT: '#f43f5e', // rose-500
          fg: '#9f1239', // rose-800
        },
        pending: {
          DEFAULT: '#f59e0b', // amber-500
          fg: '#92400e', // amber-800
        },
        // 复用 shadcn 习惯的 token 名称（指向 zinc 调色板 — 亮色版本）
        border: 'rgb(228 228 231)', // zinc-200
        input: 'rgb(228 228 231)',
        ring: '#d97706', // amber-600
        background: '#fafafa', // zinc-50
        foreground: '#18181b', // zinc-900
        primary: {
          DEFAULT: '#d97706', // amber-600（亮色背景上对比度更好）
          foreground: '#ffffff',
        },
        secondary: {
          DEFAULT: '#f4f4f5', // zinc-100
          foreground: '#18181b',
        },
        muted: {
          DEFAULT: '#f4f4f5',
          foreground: '#71717a', // zinc-500
        },
        destructive: {
          DEFAULT: '#f43f5e',
          foreground: '#ffffff',
        },
        card: {
          DEFAULT: '#ffffff',
          foreground: '#18181b',
        },
        popover: {
          DEFAULT: '#ffffff',
          foreground: '#18181b',
        },
        accent: {
          DEFAULT: '#d97706',
          foreground: '#ffffff',
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
