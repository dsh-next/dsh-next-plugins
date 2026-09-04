/**
 * Simplified Chinese mirror of the `notifier` namespace.
 *
 * Same key set as `en.ts` — the `Record<MessageKey, string>` annotation makes
 * a missing or extra key a compile error. Terminology follows this package's
 * bilingual README (启用通知/查看会话时静音/音量/浏览器/声音/需要批准/
 * 焦点跟踪); "Agent"/"Subagent" and product proper nouns (DSH Next Notifier,
 * macOS, afplay) stay English per the repo's cc-plugins reference tone.
 */
import type { MessageKey } from './en.ts'

/** The zh mirror: same keys, Simplified Chinese copy. */
export const zh: Record<MessageKey, string> = {
  'card.title': 'DSH Next Notifier',
  'card.tagline': 'Agent 完成任务或需要你时发出提醒',

  'toggle.enable': '启用通知',
  'toggle.enable.hint': '所有 Agent 通知的总开关',
  'toggle.muteViewing': '查看会话时静音',
  'toggle.muteViewing.hint': '你正在查看的会话不会发出提醒',

  'volume.label': '音量',
  'volume.hint': '所有通知的声音大小——松开滑块后立即应用并预览',
  'volume.value': '{count}%',

  'web.test': '测试浏览器通知',
  'web.hint.granted': '显示 DeepSeek 图标，点击可打开会话——即使窗口最小化或在其他标签页后面也会显示',
  'web.hint.denied': '已被浏览器阻止——通知将不会显示',
  'web.hint.unsupported': '此浏览器不支持——通知将不会显示',
  'web.hint.default': '显示 DeepSeek 图标，点击后打开对应会话',
  'web.button.test': '测试',
  'web.button.enable': '启用',
  'web.status.blocked': '已阻止',
  'web.status.unsupported': '不支持',
  'web.testTitle': '测试通知',
  'web.testBody': '浏览器通知已生效——点击这里打开本会话。',

  'group.finished.title': 'Agent 完成',
  'group.finished.hint': '当 Agent 完成回合时',
  'group.finished.subagent': 'Subagent 完成',
  'group.finished.subagent.hint': '当 Subagent 完成回合时也发送通知',
  'group.finished.goalOnly': '仅在目标完成时通知',
  'group.finished.goalOnly.hint': '目标运行期间保持安静，直到完成或受阻',
  'group.approval.title': '需要批准',
  'group.approval.hint': '当 Agent 等待你的批准时',
  'group.question.title': '提出问题',
  'group.question.hint': '当 Agent 向你提问时',
  'group.playSound': '播放声音',
  'group.sound': '声音',

  'platform.macos': 'macOS · afplay',
  'platform.windows': 'Windows · SoundPlayer',
  'platform.linux': 'Linux · paplay/aplay',
  'platform.none': '未检测到',

  'details.show': '显示详情 ▾',
  'details.hide': '收起详情 ▴',
  'details.backend': '后端：{platform} · 修改立即生效',

  'presence.waiting': '焦点跟踪：等待上报……',
  'presence.prefix': '焦点跟踪：',
  'presence.focused': '窗口聚焦',
  'presence.away': '离开',
  'presence.viewingThis': '正在查看此会话',
  'presence.viewingOther': '正在查看其他会话',
  'presence.noSession': '未打开会话',
  'presence.ageMs': '{count}ms 前',
  'presence.stale': '已过期',

  'rpc.failed': '通知请求“{method}”失败（HTTP {status}）',
}
