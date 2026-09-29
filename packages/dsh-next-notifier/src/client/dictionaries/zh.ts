/**
 * Simplified Chinese mirror of the `notifier` namespace.
 *
 * Same key set as `en.ts` — the `Record<MessageKey, string>` annotation makes
 * a missing or extra key a compile error. Terminology follows this package's
 * bilingual README (启用通知/查看会话时静音/音量/浏览器/声音/需要批准/
 * 焦点跟踪); "Agent"/"Subagent" and product proper nouns (DSH Next Notifier,
 * macOS, afplay) stay English per the repository's English host-string convention.
 */
import type { MessageKey } from './en.ts'

/** The zh mirror: same keys, Simplified Chinese copy. */
export const zh: Record<MessageKey, string> = {
  'settings.loading': '正在加载通知设置……',
  'settings.unavailable': '通知设置不可用。请启用插件并重新打开此页面。',
  'settings.readOnly': '当前连接中的设置为只读。',
  'settings.saveFailed': '更改未保存。请检查连接，然后再次修改此设置。',
  'settings.automatic': '更改会自动应用。',
  'settings.saving': '正在保存……',
  'settings.reset': '恢复继承的设置',
  'sound.chime': '风铃', 'sound.ping': '轻响', 'sound.bell': '铃铛',
  'sound.alert': '警报', 'sound.error': '错误', 'sound.success': '成功',
  'sound.chirp': '啁啾', 'sound.pop': '爆破', 'sound.knock': '敲击',
  'sound.whoosh': '呼啸', 'sound.magic': '魔法', 'sound.blip': '短音',
  'sound.ring': '铃声', 'sound.gong': '锣声',
  'sound.fart-classic': '屁声 · 经典', 'sound.fart-deep': '屁声 · 低沉', 'sound.fart-squeaky': '屁声 · 尖细',
  'sound.preview': '试听',
  'sound.failed': '无法播放声音。请检查此设备的音频设置，然后再次试听。',
  'delivery.title': '此设备上的通知',
  'delivery.failed': '系统未确认此通知。请检查通知权限并重试。',
  'toast.openSession': '打开会话',
  'event.default': 'DeepSeek Harness',
  'event.finished': 'Agent 完成',
  'event.approval': '需要批准',
  'event.question': '提出问题',
  'event.subagent': 'Subagent 完成',
  'event.subagentError': 'Subagent 遇到错误',
  'event.subagentBlocked': 'Subagent 受阻',
  'event.subagentMaxTokens': 'Subagent 已达到响应限制',
  'event.goalComplete': '目标已完成',
  'event.goalBlocked': '目标受阻',
  'event.error': 'Agent 遇到错误',
  'event.blocked': 'Agent 受阻',
  'event.maxTokens': '已达到响应限制',
  'card.title': 'Notifier',
  'card.tagline': 'Agent 完成任务或需要你时发出提醒',

  'toggle.enable': '启用通知',
  'toggle.enable.hint': '所有 Agent 通知的总开关',
  'toggle.muteViewing': '查看会话时静音',
  'toggle.muteViewing.hint': '你正在查看的会话不会发出提醒',

  'volume.label': '音量',
  'volume.hint': '在此设备上播放。更改会自动应用，点击试听以启用音频。',
  'volume.value': '{count}%',

  'web.test': '系统通知',
  'web.hint.granted': '已在此设备上允许通知。系统权限或勿扰模式仍可能隐藏提醒。',
  'web.hint.denied': '通知已被阻止。请在浏览器或系统设置中允许通知，然后返回此处。',
  'web.hint.unsupported': '此客户端无法显示系统通知，应用内提醒仍然可用。',
  'web.hint.default': '允许此客户端在 Harness 处于后台时通知你。',
  'web.button.test': '测试',
  'web.button.enable': '启用',
  'web.status.blocked': '已阻止',
  'web.status.unsupported': '不支持',
  'web.testTitle': '测试通知',
  'web.testBody': '浏览器通知已生效——点击这里打开本会话。',

  'toast.test': '测试页面内弹窗',
  'toast.test.hint': '在你正查看页面时，在页面内显示一条弹窗提醒',
  'toast.button.test': '显示',
  'toast.testTitle': '测试弹窗',
  'toast.testBody': '页面内弹窗已生效——点击这里打开本会话。',
  'toast.close': '关闭',
  'toast.layerLabel': '会话弹窗',

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

  'rpc.timeout': '通知请求“{method}”超时，请重试。',
  'rpc.disposed': '通知插件已停用。',
  'rpc.failed': '通知请求“{method}”失败（HTTP {status}）',
}
