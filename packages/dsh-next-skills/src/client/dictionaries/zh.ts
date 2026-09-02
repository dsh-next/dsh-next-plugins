/**
 * Simplified Chinese mirror of the `skills` namespace.
 *
 * Same key set as `en.ts` — the `Record<MessageKey, string>` annotation makes
 * a missing or extra key a compile error. Terminology follows the repo
 * glossary (技能/安装/更新/卸载/移除/全局/工作区/提供方/搜索/作用域);
 * "agent", "frontmatter", "markdown", and on-screen literals of third-party
 * tooling stay English.
 */
import type { MessageKey } from './en.ts'

/** The zh mirror: same keys, Simplified Chinese copy. */
export const zh: Record<MessageKey, string> = {
  'nav': '技能',

  'tab.skills': '技能',
  'tab.providers': '提供方',

  'search.placeholder': '搜索技能…',
  'provider.aria': '提供方',
  'provider.all': '全部提供方',
  'filter.installedOnly': '仅显示已安装',

  'empty.noProviders': '还没有提供方。在“提供方”标签页添加一个 GitHub 仓库即可浏览其中的技能。',
  'empty.noMatch': '没有符合当前筛选条件的技能。',

  'card.noDescription': '暂无描述',
  'card.detailsTitle': '查看 {name}',
  'card.update': '更新',
  'card.manage': '管理',
  'card.add': '添加',
  'card.updateAvailable': '有可用更新',

  'presence.everywhere': '所有位置',
  'presence.workspaces.one': '{count} 个工作区',
  'presence.workspaces.many': '{count} 个工作区',
  'presence.off': '已关闭',

  'badge.custom': '自建',
  'badge.project': '项目',

  'sync.never': '从未同步',
  'sync.unknown': '未知',
  'sync.justNow': '刚刚同步',
  'sync.minutesAgo': '{count} 分钟前',
  'sync.hoursAgo': '{count} 小时前',
  'sync.daysAgo': '{count} 天前',

  'modal.aria': '管理技能“{name}”',
  'modal.hint': '技能只安装一次，存放在全局技能目录中；作用域仅控制它在哪些工作区启用。',
  'modal.scope.global': '全局（所有工作区）',
  'modal.scope.workspaces': '选中的工作区',
  'modal.workspaces.empty': '尚未注册任何工作区。',
  'modal.workspaces.hint': '该技能只在勾选的工作区内启用。',
  'modal.workspaceMissing': '未注册',
  'modal.save': '保存作用域',
  'modal.update': '更新',
  'modal.uninstall': '卸载',
  'modal.confirmUninstall': '确认卸载',
  'modal.cancel': '取消',

  'providers.placeholder': 'owner/repo 或 GitHub 链接…',
  'providers.add': '添加提供方',
  'providers.refreshAll': '全部刷新',
  'providers.remove': '移除',
  'providers.skillCount.one': '{count} 个技能',
  'providers.skillCount.many': '{count} 个技能',
  'providers.lastSynced': '上次同步于 {age}',
  'providers.hint': '提供方是包含技能目录（SKILL.md）的 GitHub 仓库；同步会把技能文件缓存到本地，安装无需再次联网。',

  'detail.aria': '技能详情“{name}”',
  'detail.modelInvocable': '模型可调用',
  'detail.modelBlocked': '模型不可调用',
  'detail.userInvocable': '用户可调用',
  'detail.userBlocked': '用户不可调用',
  'detail.whenToUse': '适用场景：{text}',
  'detail.close': '关闭',

  'list.showMore': '显示更多技能',

  'status.working': '处理中…',
  'status.done': '完成',
}
