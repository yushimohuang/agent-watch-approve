// =====================================================
// Core - Event Collector
// =====================================================

import { Readable } from 'stream';
import { Logger } from '../utils/logger';
import type { AgentType } from '@agent-watch/shared';

export interface EventCollectorConfig {
  sessionId: string;
  onEvent?: (event: any) => void;
}

/**
 * Event Collector - Parses JSONL events from AI agents
 */
export class EventCollector {
  private config: EventCollectorConfig;
  private buffer: string = '';
  private logger: Logger;

  constructor(config: EventCollectorConfig) {
    this.config = config;
    this.logger = Logger.getInstance();
  }

  /**
   * Attach to a readable stream (e.g., stdout)
   */
  attach(stream: Readable | NodeJS.ReadableStream): void {
    stream.on('data', (chunk: Buffer) => {
      this.processChunk(chunk.toString());
    });

    stream.on('end', () => {
      // Process any remaining buffer
      if (this.buffer.trim()) {
        this.processLine(this.buffer);
      }
    });

    stream.on('error', (error: Error) => {
      this.logger.error('Stream error', { error, sessionId: this.config.sessionId });
    });
  }

  /**
   * Process incoming chunk of data
   */
  private processChunk(chunk: string): void {
    this.buffer += chunk;

    // Split by newlines
    const lines = this.buffer.split('\n');
    
    // Keep the last incomplete line in buffer
    this.buffer = lines.pop() || '';

    // Process each complete line
    for (const line of lines) {
      this.processLine(line);
    }
  }

  /**
   * Process a single line
   */
  private processLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    try {
      const event = JSON.parse(trimmed);
      
      // Validate event structure
      if (this.isValidEvent(event)) {
        this.logger.debug('Parsed event', { type: event.type, sessionId: this.config.sessionId });
        this.config.onEvent?.(event);
      }
    } catch (error) {
      // Not JSON, might be plain text output
      // We don't log these as errors to avoid noise
    }
  }

  /**
   * Check if event has valid structure
   */
  private isValidEvent(event: any): boolean {
    if (!event || typeof event !== 'object') return false;
    
    // Check for common event types
    const validTypes = [
      'thread.started',
      'turn.started',
      'turn.completed',
      'turn.failed',
      'item.started',
      'item.updated',
      'item.completed',
      'error',
    ];

    if (event.type && validTypes.includes(event.type)) {
      return true;
    }

    // Check for other known structures
    if (event.event_type) return true;

    return false;
  }
}

/**
 * Event types from Codex JSONL output
 */
export interface CodexEvent {
  type: string;
  thread_id?: string;
  turn_id?: string;
  item?: ThreadItem;
  usage?: TokenUsage;
  error?: { message: string };
  [key: string]: any;
}

export interface ThreadItem {
  id: string;
  type: string;
  command?: string;
  aggregated_output?: string;
  exit_code?: number;
  status?: string;
  changes?: FileChange[];
  text?: string;
  [key: string]: any;
}

export interface FileChange {
  path: string;
  kind: 'add' | 'delete' | 'update';
}

export interface TokenUsage {
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
}
