/**
 * Simplified Chinese mirror of the `skills` namespace.
 *
 * Same key set as `en.ts` — the `Record<MessageKey, string>` annotation makes
 * a missing or extra key a compile error. Terminology follows the repo
 * glossary (技能/安装/更新/移除/全局/工作区/提供方/搜索/作用域);
 * "agent", "frontmatter", "markdown", and on-screen literals of third-party
 * tooling stay English.
 */
import type { MessageKey } from './en.ts'

/** The zh mirror: same keys, Simplified Chinese copy. */
export const zh: Record<MessageKey, string> = {
  'section.title': '技能',

  'tab.skills': '技能',
  'tab.providers': '提供方',

  'search.placeholder': '搜索技能…',
  'filter.installedOnly': '仅显示已安装',
  'provider.aria': '提供方',
  'provider.all': '全部提供方',

  'list.showing': '正在显示 {total} 个技能中的 {shown} 个',
  'list.showMore': '显示更多技能',

  'card.add': '添加',
  'card.manage': '管理',
  'card.update': '更新',
  'card.installed': '已安装',
  'card.noDescription': '暂无描述',
  'card.detailsTitle': '查看 {name}',

  'presence.everywhere': '所有位置',
  'presence.workspaces.one': '{count} 个工作区',
  'presence.workspaces.many': '{count} 个工作区',
  'presence.off': '已关闭',
  'presence.in': '位于 {targets}',

  'badge.custom': '自建',
  'badge.project': '项目',

  'modal.aria': '技能 {name}',
  'modal.hint': '技能只安装一次，存放在全局技能目录中；作用域仅控制它在哪些工作区启用。',
  'modal.scope.global': '所有位置（默认）',
  'modal.scope.workspaces': '仅在选中的工作区',
  'modal.workspaces.empty': '尚未注册任何工作区。',
  'modal.workspaces.hint': '该技能在未勾选的工作区中保持停用。',
  'modal.workspaceMissing': '已失效',
  'modal.update': '更新',
  'modal.remove': '移除',
  'modal.confirmRemove': '确认移除',
  'modal.save': '保存',
  'modal.cancel': '取消',

  'providers.placeholder': 'owner/repo 或 GitHub 链接…',
  'providers.add': '添加提供方',
  'providers.refreshAll': '全部刷新',
  'providers.remove': '移除',
  'providers.skillCount.one': '{count} 个技能',
  'providers.skillCount.many': '{count} 个技能',
  'providers.syncNever': '从未同步',
  'providers.justNow': '刚刚同步',
  'providers.minutesAgo': '{count} 分钟前同步',
  'providers.hoursAgo': '{count} 小时前同步',
  'providers.daysAgo': '{count} 天前同步',
  'providers.hint': '提供方是包含技能目录（SKILL.md）的 GitHub 仓库；同步会把技能文件缓存到本地，安装无需再次联网。',

  'empty.noProviders': '还没有提供方。在“提供方”标签页添加一个 GitHub 仓库即可浏览其中的技能。',
  'empty.noMatch': '没有匹配的技能。',

  'detail.aria': '技能 {name}',
  'detail.version': '版本 {version}',
  'detail.from': '来自 {provider}',
  'detail.notInstalled': '未安装',
  'detail.modelInvocable': '模型可调用',
  'detail.modelBlocked': '模型不可调用',
  'detail.userInvocable': '用户可调用',
  'detail.userBlocked': '用户不可调用',
  'detail.whenToUse': '适用场景：{text}',
  'detail.close': '关闭',

  'error.loadDetail': '无法加载技能详情',

  'status.working': '处理中…',
}
