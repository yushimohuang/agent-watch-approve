/**
 * 所有国产 AI Agent Adapter 单元测试
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// 模拟 fs
jest.mock('fs', () => {
  const realFs = jest.requireActual('fs');
  return {
    promises: {
      mkdir: jest.fn().mockResolvedValue(undefined),
      readFile: jest.fn().mockRejectedValue(new Error('ENOENT')),
      writeFile: jest.fn().mockResolvedValue(undefined),
      access: jest.fn().mockRejectedValue(new Error('ENOENT')),
      rm: jest.fn().mockResolvedValue(undefined),
      chmod: jest.fn().mockResolvedValue(undefined),
      readdir: jest.fn().mockResolvedValue([]),
    },
    existsSync: realFs.existsSync,  // 使用真实 existsSync
    readFileSync: realFs.readFileSync,  // 使用真实 readFileSync
  };
});

// 模拟 child_process
jest.mock('child_process', () => ({
  exec: jest.fn(),
  spawn: jest.fn(),
  execSync: jest.fn(),
}));

import { CodeBuddyAdapter } from '../../src/agents/codebuddy.adapter';
import { QoderCNAdapter } from '../../src/agents/qoder-cn.adapter';
import { MiMoAdapter } from '../../src/agents/mimo.adapter';
import { MiniMaxAdapter } from '../../src/agents/minimax.adapter';
import { TraeAdapter } from '../../src/agents/trae.adapter';
import { ComateAdapter } from '../../src/agents/comate.adapter';

const testConfig = {
  gatewayUrl: 'http://localhost:3000',
  userId: 'test_user_001',
  approvalTimeout: 60,
};

describe('CodeBuddy (腾讯云) Adapter', () => {
  let adapter: CodeBuddyAdapter;

  beforeEach(() => {
    adapter = new CodeBuddyAdapter();
  });

  it('should have correct platform metadata', () => {
    expect(adapter.platform).toBe('codebuddy');
    expect(adapter.displayName).toContain('腾讯');
    expect(adapter.hookSupport).toBe('full');
  });

  it('should install hook in CodeBuddy format', async () => {
    (fs.promises.readFile as jest.Mock).mockRejectedValue(new Error('ENOENT'));

    const result = await adapter.install(testConfig);

    expect(result.success).toBe(true);
    expect(result.hookCommand).toBe('agent-watch approve');
  });
});

describe('Qoder CN (通义灵码) Adapter', () => {
  let adapter: QoderCNAdapter;

  beforeEach(() => {
    adapter = new QoderCNAdapter();
  });

  it('should have correct platform metadata', () => {
    expect(adapter.platform).toBe('qoder-cn');
    expect(adapter.displayName).toContain('通义');
    expect(adapter.hookSupport).toBe('full');
  });

  it('should install hook in Qoder format', async () => {
    (fs.promises.readFile as jest.Mock).mockRejectedValue(new Error('ENOENT'));

    const result = await adapter.install(testConfig);

    expect(result.success).toBe(true);
  });
});

describe('MiMo (小米) Adapter', () => {
  let adapter: MiMoAdapter;

  beforeEach(() => {
    adapter = new MiMoAdapter();
  });

  it('should have correct platform metadata', () => {
    expect(adapter.platform).toBe('mimo');
    expect(adapter.displayName).toContain('小米');
    expect(adapter.hookSupport).toBe('full');
  });

  it('should install hook and plugin', async () => {
    (fs.promises.readFile as jest.Mock).mockRejectedValue(new Error('ENOENT'));

    const result = await adapter.install(testConfig);

    expect(result.success).toBe(true);
  });
});

describe('MiniMax Adapter', () => {
  let adapter: MiniMaxAdapter;

  beforeEach(() => {
    adapter = new MiniMaxAdapter();
  });

  it('should have correct platform metadata', () => {
    expect(adapter.platform).toBe('minimax');
    expect(adapter.hookSupport).toBe('full');
  });

  it('should install hook with SKILL', async () => {
    (fs.promises.readFile as jest.Mock).mockRejectedValue(new Error('ENOENT'));

    const result = await adapter.install(testConfig);

    expect(result.success).toBe(true);
  });
});

describe('Trae (字节跳动) Adapter', () => {
  let adapter: TraeAdapter;

  beforeEach(() => {
    adapter = new TraeAdapter();
  });

  it('should have correct platform metadata', () => {
    expect(adapter.platform).toBe('trae');
    expect(adapter.displayName).toContain('字节');
    expect(adapter.hookSupport).toBe('full');
  });
});

describe('Comate (百度) Adapter', () => {
  let adapter: ComateAdapter;

  beforeEach(() => {
    adapter = new ComateAdapter();
  });

  it('should have correct platform metadata', () => {
    expect(adapter.platform).toBe('comate');
    expect(adapter.displayName).toContain('百度');
    expect(adapter.hookSupport).toBe('full');
  });
});

describe('CLI Tool', () => {
  it('should have proper CLI package.json', () => {
    const cliPackagePath = path.join(__dirname, '../../../cli/package.json');
    const exists = fs.existsSync(cliPackagePath);

    if (exists) {
      const pkg = JSON.parse(fs.readFileSync(cliPackagePath, 'utf-8'));
      expect(pkg.name).toBe('agent-watch-cli');
      expect(pkg.bin).toHaveProperty('agent-watch');
    }
  });

  it('should have proper CLI script', () => {
    const cliPath = path.join(__dirname, '../../../cli/agent-watch.js');
    const exists = fs.existsSync(cliPath);

    if (exists) {
      const content = fs.readFileSync(cliPath, 'utf-8');
      expect(content).toContain('agent-watch CLI');
      expect(content).toContain('approve');
    }
  });
});

describe('Hook Scripts', () => {
  it('should have Claude Code hook', () => {
    const hookPath = path.join(__dirname, '../../src/agents/hooks/claude-code-hook.sh');
    expect(fs.existsSync(hookPath)).toBe(true);
  });

  it('should have Qoder CN hook', () => {
    const hookPath = path.join(__dirname, '../../src/agents/hooks/qoder-cn-hook.py');
    expect(fs.existsSync(hookPath)).toBe(true);
  });

  it('should have CodeBuddy hook', () => {
    const hookPath = path.join(__dirname, '../../src/agents/hooks/codebuddy-hook.py');
    expect(fs.existsSync(hookPath)).toBe(true);
  });
});
