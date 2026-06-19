// =====================================================
// Utils - Logger
// =====================================================

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LOG_COLORS: Record<LogLevel, string> = {
  debug: '\x1b[90m',   // Gray
  info: '\x1b[36m',    // Cyan
  warn: '\x1b[33m',    // Yellow
  error: '\x1b[31m',   // Red
};

const RESET = '\x1b[0m';

export class Logger {
  private static instance: Logger;
  private minLevel: LogLevel;

  private constructor() {
    // Determine log level from environment
    const envLevel = process.env.AGENT_WATCH_APPROVE_VERBOSE ? 'debug' : 'info';
    this.minLevel = envLevel as LogLevel;
  }

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log('debug', message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log('info', message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log('warn', message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.log('error', message, context);
  }

  private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (LOG_LEVELS[level] < LOG_LEVELS[this.minLevel]) {
      return;
    }

    const timestamp = new Date().toISOString();
    const color = LOG_COLORS[level];
    const levelStr = level.toUpperCase().padEnd(5);
    
    // Format context
    const contextStr = context ? ` ${JSON.stringify(context)}` : '';

    // Use console.log with color codes for terminal
    const output = `${color}[${timestamp}] [${levelStr}]${RESET} ${message}${contextStr}`;

    switch (level) {
      case 'error':
        console.error(output);
        break;
      case 'warn':
        console.warn(output);
        break;
      default:
        console.log(output);
    }
  }
}
