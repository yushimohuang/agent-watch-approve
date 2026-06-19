/**
 * 飞书 Interactive 卡片构建器
 *
 * 飞书卡片是 JSON 格式，支持 markdown + 按钮（多平台一致：iOS/Android/Mac/Windows/手表镜像）
 *
 * 卡片规范：https://open.feishu.cn/document/uAjLw4CM/ukzMukzMukzM/feishu-cards/card-structure
 *
 * 按钮类型：
 * - callback 按钮（value 回调）：手机/PC 上点击后飞书服务器回调 webhook，最可靠
 * - url 按钮（跳转链接）：手表上点击后直接打开浏览器访问 Gateway，一键审批
 *
 * 策略：同时放 callback + url 两种按钮
 * - 手机/PC：点 callback 按钮 → webhook 回调 → 即时更新卡片
 * - 手表：收到飞书系统通知 → 点通知打开飞书 → 看到卡片 → 点 url 按钮直接审批
 */

import { config } from '../config';

/**
 * 审批负载（飞书单通道统一类型）
 */
export interface ApprovalPayload {
  userId: string;
  approvalId: string;
  agentPlatform: string;
  sessionName: string;
  command: string | string[];
  reason: string;
  isUrgent: boolean;
  expiresAt: number;
  cwd?: string;
  deviceTokens?: string[];
}

/**
 * 推送结果
 */
export interface PushResult {
  success: boolean;
  messageId?: string;
  error?: string;
  rawResponse?: any;
}

export interface FeishuCardButton {
  tag: 'button';
  text: { tag: 'plain_text'; content: string };
  type: 'primary' | 'danger' | 'default';
  value?: Record<string, any>;
  url?: string;
  multi_url?: {
    pc_url?: string;
    android_url?: string;
    ios_url?: string;
  };
}

export interface FeishuCardHeader {
  title: { tag: 'plain_text'; content: string };
  template: 'blue' | 'red' | 'green' | 'orange' | 'purple' | 'grey';
}

export interface FeishuCard {
  config?: { wide_screen_mode?: boolean };
  header: FeishuCardHeader;
  elements: any[];
}

export interface FeishuInteractiveMessage {
  msg_type: 'interactive';
  card: FeishuCard;
  // receive_id 用 open_id (ou_xxx) 或 email
  receive_id?: string;
  // uo 接收标识 - 飞书 API 接受 `receive_id_type: open_id` 后可用
}

const RED = 'red';
const ORANGE = 'orange';
const BLUE = 'blue';

/**
 * 风险等级 → 颜色 / Emoji
 */
function riskLevelStyle(riskLevel?: string): { color: string; emoji: string; label: string } {
  switch (riskLevel) {
    case 'high':
      return { color: RED, emoji: '🔴', label: '高风险' };
    case 'medium':
      return { color: ORANGE, emoji: '🟠', label: '中风险' };
    case 'low':
      return { color: BLUE, emoji: '🟢', label: '低风险' };
    default:
      return { color: ORANGE, emoji: '🟠', label: '需审批' };
  }
}

/**
 * 截断命令用于显示（卡片有长度限制）
 */
function truncateCommand(command: string, max = 200): string {
  if (!command) return '';
  if (command.length <= max) return command;
  return command.substring(0, max - 3) + '...';
}

/**
 * 构造审批请求卡片
 *
 * 卡片结构：
 * - header：红/橙/蓝色横条 + 标题
 * - div 1：会话名 / Agent / 时间
 * - div 2：命令（代码块）
 * - div 3：原因 / 风险
 * - hr
 * - action 1：callback 按钮（批准/拒绝）— 手机/PC 点击后 webhook 回调
 * - action 2：url 按钮（手表快捷操作）— 直接打开 Gateway 审批页
 * - note：过期时间 + 会话 ID
 *
 * 手表弹窗流程：
 * 1. 飞书推送卡片 → 飞书 App 收到消息 → 系统通知弹窗（手表可见）
 * 2. 手表上看到通知摘要 → 点通知 → 打开飞书卡片
 * 3. 点 url 按钮 → 打开 Gateway 审批页 → 一键审批
 */
export function buildApprovalCard(params: {
  approvalId: string;
  command: string;
  reason: string;
  sessionName: string;
  agentPlatform: string;
  isUrgent: boolean;
  expiresAt: number;
  riskLevel?: string;
  cwd?: string;
  actionToken?: string;
}): FeishuCard {
  const risk = riskLevelStyle(params.riskLevel);
  const color = params.isUrgent ? RED : risk.color;

  const headerTitle = params.isUrgent
    ? '⚠️ [紧急] AI 需要你的批准'
    : `${risk.emoji} ${risk.label}：AI 需要你的批准`;

  const minutesLeft = Math.max(0, Math.round((params.expiresAt - Date.now()) / 60000));

  // 主操作按钮 - callback 模式（手机/PC 上点击后飞书回调 webhook）
  const callbackActions: FeishuCardButton[] = [
    {
      tag: 'button',
      text: { tag: 'plain_text', content: '✓ 批准' },
      type: 'primary',
      value: {
        action: 'approve',
        approval_id: params.approvalId,
        session_name: params.sessionName,
      },
    },
    {
      tag: 'button',
      text: { tag: 'plain_text', content: '✗ 拒绝' },
      type: 'danger',
      value: {
        action: 'deny',
        approval_id: params.approvalId,
        session_name: params.sessionName,
      },
    },
  ];

  // URL 按钮 - 跳转模式（手表/任何设备点击后直接审批）
  // 注：v2.1 安全增强（双保险）：
  //   1. URL 带一次性 token（5 分钟过期，HMAC 签名）
  //   2. confirm=1 直接审批（飞书手表浏览器体验差，跳过二次确认）
  //   - 攻击者拿到 approval_id 也不能直接决策（无 token）
  //   - 攻击者有 5 分钟窗口（远大于攻击实际可行性）
  //   - 普通用户有充足时间（看通知→解锁→点按钮 = 5 分钟内）
  //   - 一次使用后 token 作废（重放攻击无效）
  const urlActions: FeishuCardButton[] = [
    {
      tag: 'button',
      text: { tag: 'plain_text', content: '✓ 批准' },
      type: 'primary',
      url: `${config.publicUrl}/webhook/feishu-direct?action=approve&approval_id=${params.approvalId}&token=${params.actionToken || 'REQUIRED'}&confirm=1`,
    },
    {
      tag: 'button',
      text: { tag: 'plain_text', content: '✗ 拒绝' },
      type: 'danger',
      url: `${config.publicUrl}/webhook/feishu-direct?action=deny&approval_id=${params.approvalId}&token=${params.actionToken || 'REQUIRED'}&confirm=1`,
    },
  ];

  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: headerTitle },
      template: color as 'blue' | 'red' | 'green' | 'orange' | 'purple' | 'grey',
    },
    elements: [
      // 块 1: 会话上下文
      {
        tag: 'div',
        fields: [
          {
            is_short: true,
            text: { tag: 'lark_md', content: `**Agent**\n${params.agentPlatform || 'AI 工具'}` },
          },
          {
            is_short: true,
            text: {
              tag: 'lark_md',
              content: `**会话**\n${params.sessionName || '未命名会话'}`,
            },
          },
        ],
      },
      // 块 1.5: 项目路径
      ...(params.cwd
        ? [{
            tag: 'div',
            text: {
              tag: 'lark_md',
              content: `**项目**\n\`${params.cwd}\``,
            },
          }]
        : []),
      // 块 2: 命令（代码块）
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**命令**\n\`\`\`\n${truncateCommand(params.command)}\n\`\`\``,
        },
      },
      // 块 3: 原因 + 风险
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: params.reason
            ? `**原因**\n${params.reason}\n\n**风险等级**：${risk.emoji} ${risk.label}`
            : `**风险等级**：${risk.emoji} ${risk.label}`,
        },
      },
      // 分隔线
      { tag: 'hr' },
      // 主操作（callback 按钮 - 手机/PC 用）
      {
        tag: 'action',
        actions: callbackActions,
      },
      // 手表/快捷操作（url 按钮 - 一键审批）
      {
        tag: 'action',
        layout: 'bisected',
        actions: urlActions,
      },
      // 过期提示
      {
        tag: 'note',
        elements: [
          {
            tag: 'plain_text',
            content: `⏱ ${minutesLeft} 分钟后过期 · ${params.approvalId.substring(0, 8)} · 手表用户请点下方按钮`,
          },
        ],
      },
    ],
  };
}

/**
 * 构造审批结果通知卡片（向用户回报"已批准" / "已拒绝"）
 */
export function buildResultCard(params: {
  approvalId: string;
  decision: 'approve' | 'deny' | 'cancel';
  decidedBy: string;
  decidedAt: string;
  sessionName: string;
}): FeishuCard {
  const decisionEmoji =
    params.decision === 'approve' ? '✅' : params.decision === 'deny' ? '⛔' : '🚫';
  const decisionLabel =
    params.decision === 'approve'
      ? '已批准'
      : params.decision === 'deny'
      ? '已拒绝'
      : '已取消';

  return {
    header: {
      title: { tag: 'plain_text', content: `${decisionEmoji} 审批${decisionLabel}` },
      template:
        params.decision === 'approve' ? 'green' : params.decision === 'deny' ? 'red' : 'grey',
    },
    elements: [
      {
        tag: 'div',
        fields: [
          {
            is_short: true,
            text: { tag: 'lark_md', content: `**会话**\n${params.sessionName || '未命名'}` },
          },
          {
            is_short: true,
            text: { tag: 'lark_md', content: `**决策人**\n${params.decidedBy || '用户'}` },
          },
        ],
      },
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**时间**\n${new Date(params.decidedAt).toLocaleString('zh-CN')}`,
        },
      },
      {
        tag: 'note',
        elements: [
          {
            tag: 'plain_text',
            content: `审批 ID: ${params.approvalId}`,
          },
        ],
      },
    ],
  };
}

/**
 * 构造飞书 Open API 发送消息的请求体
 *
 * 文档：https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message/create
 */
export function buildMessageRequest(params: {
  receiveId: string;
  receiveIdType: 'open_id' | 'user_id' | 'email' | 'union_id' | 'chat_id';
  card: FeishuCard;
  uuid?: string;
}): {
  receive_id: string;
  msg_type: 'interactive';
  content: string;
  uuid?: string;
} {
  return {
    receive_id: params.receiveId,
    msg_type: 'interactive',
    content: JSON.stringify(params.card),
    uuid: params.uuid,
  };
}

/**
 * 将 ApprovalPayload 转换为 ApprovalCard 需要的参数
 */
export function approvalPayloadToCardParams(
  payload: ApprovalPayload,
  riskLevel?: string,
  actionToken?: string,
): {
  approvalId: string;
  command: string;
  reason: string;
  sessionName: string;
  agentPlatform: string;
  isUrgent: boolean;
  expiresAt: number;
  riskLevel?: string;
  cwd?: string;
  actionToken?: string;
} {
  const commandText = Array.isArray(payload.command)
    ? payload.command.join(' ')
    : String(payload.command || '');
  return {
    approvalId: payload.approvalId,
    command: commandText,
    reason: payload.reason || '',
    sessionName: payload.sessionName || '未命名会话',
    agentPlatform: payload.agentPlatform || 'AI 工具',
    isUrgent: payload.isUrgent,
    expiresAt: payload.expiresAt,
    riskLevel,
    cwd: payload.cwd,
    actionToken,
  };
}
