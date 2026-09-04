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

  'title': '技能',
  'intro': '从提供方安装技能，并控制每个技能的启用位置。',
  'tabs': '技能视图',

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
  'card.delete': '删除',
  'card.scopes': '作用域',
  'card.use': '使用',
  'card.replace': '更换',
  'card.replaceTitle': '将已安装的副本替换为 {provider} 的版本',
  'card.currentSource': '当前来源',
  'card.sources.one': '{count} 个来源',
  'card.sources.many': '{count} 个来源',

  'presence.everywhere': '所有位置',
  'presence.workspaces.one': '{count} 个工作区',
  'presence.workspaces.many': '{count} 个工作区',
  'presence.off': '已关闭',

  'source.projectDsh': '项目 .dsh',
  'source.projectAgents': '项目 .agents',
  'source.userDsh': '用户 .dsh',
  'source.userAgents': '用户 .agents',
  'source.custom': '自定义',

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
  'modal.cancel': '取消',
  'modal.effectHint': '作用域更改会在下次查找或新会话时生效。',
  'modal.confirmDelete': '删除',

  'delete.aria': '删除技能“{name}”',
  'delete.title': '删除 {name}？',
  'delete.hint': '这会将下方副本移入其根目录的回收站（可恢复）。',

  'providers.placeholder': 'owner/repo 或 GitHub 链接…',
  'providers.add': '添加提供方',
  'providers.refreshAll': '全部刷新',
  'providers.refreshing': '正在刷新…',
  'providers.refreshProgress': '正在刷新 {done}/{total}…',
  'providers.refreshFailed': '{count} 个提供方刷新失败：{items}',
  'providers.remove': '移除',
  'providers.skillCount.one': '{count} 个技能',
  'providers.skillCount.many': '{count} 个技能',
  'providers.lastSynced': '上次同步于 {age}',
  'providers.removeAria': '移除提供方“{name}”',
  'providers.removeTitle': '移除 {name}？',
  'providers.removeHint': '已安装的技能会保留；提供方及其缓存的技能目录会被移除。',
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
  'status.requestFailed': '请求失败',
  'status.refreshFailed': '刷新失败',
  'rpc.failed': '技能请求“{method}”失败（HTTP {status}）',
}
