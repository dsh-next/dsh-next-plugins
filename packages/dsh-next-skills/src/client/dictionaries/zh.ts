/**
 * Simplified Chinese mirror of the `skills` namespace.
 *
 * Same key set as `en.ts` — the `Record<MessageKey, string>` annotation makes
 * a missing or extra key a compile error. Terminology follows the repo
 * glossary (技能/安装/更新/移除/启用/停用/全局/工作区/提供方/搜索/作用域/影子副本);
 * "agent", "frontmatter", "markdown", and on-screen literals of third-party
 * tooling stay English.
 */
import type { MessageKey } from './en.ts'

/** The zh mirror: same keys, Simplified Chinese copy. */
export const zh: Record<MessageKey, string> = {
  'section.title': '技能',

  'tab.installed': '已安装',
  'tab.search': '搜索',
  'tab.providers': '提供方',

  'search.placeholder': '搜索技能…',
  'search.showing': '正在显示 {total} 个技能中的 {shown} 个',
  'search.allShown': '已显示全部 {total} 个技能',
  'search.loadMore': '加载更多技能',

  'provider.aria': '提供方',
  'provider.all': '全部提供方',
  'provider.placeholder': 'https://github.com/owner/repo 或 owner/repo…',
  'provider.refresh': '刷新',
  'provider.refreshAll': '全部刷新',
  'provider.skillCount.one': '{count} 个技能',
  'provider.skillCount.many': '{count} 个技能',
  'provider.stars': ' · ★ {count}',
  'provider.lastRefresh.never': '从未刷新',
  'provider.lastRefresh.justNow': '刚刚刷新',
  'provider.lastRefresh.minutesAgo': '刷新于 {count} 分钟前',
  'provider.lastRefresh.hoursAgo': '刷新于 {count} 小时前',
  'provider.lastRefresh.daysAgo': '刷新于 {count} 天前',
  'provider.empty': '还没有提供方。请添加一个包含技能（带 SKILL.md 的目录）的 GitHub 仓库，将技能下载到本地市场。',

  'empty.noInstalled': '此作用域中尚未安装技能。',
  'empty.noProviders': '还没有提供方。请在“提供方”标签页添加一个 GitHub 仓库来搜索其技能。',
  'empty.noCatalog': '目录中还没有技能——请在“提供方”标签页刷新提供方。',
  'empty.noMatch': '没有符合搜索条件的技能。',

  'scope.globalStar': '⭐ 全局',
  'scope.workspace': '工作区',
  'scope.globalOnly': '仅全局',
  'scope.disabledMarker': ' · 已停用',
  // The `shadow` badge stays verbatim in every locale: tests assert the word
  // and host diagnostics quote it.
  'scope.shadowMarker': ' · shadow',
  'scope.hint': '“已安装”标签页的作用域；在这里关闭开关只会在此工作区中停用全局技能',

  'presence.global': '全局',
  'presence.workspace.one': '{count} 个工作区',
  'presence.workspace.many': '{count} 个工作区',
  'presence.in': '位于 {targets}',

  'action.enable': '启用',
  'action.disable': '停用',
  'action.remove': '移除',
  'action.update': '更新',
  'action.updateAllCopies': '更新全部副本',
  'action.add': '添加',
  'action.cancel': '取消',

  'badge.custom': '自定义',

  'aria.viewSkill': '查看 {name}',

  'confirm.removeSkillTitle': '移除技能“{name}”？',
  'confirm.removeSkillMessage': '技能会移动到其技能根目录的 .trash 目录中，可以手动恢复。',
  'confirm.removeProviderTitle': '移除提供方“{spec}”？',
  'confirm.removeProviderMessage': '其缓存的目录会被删除；已安装的技能保持不变。',

  'add.title': '添加技能“{name}”',
  'add.hint': '选择添加位置。已持有该技能的目标会被标记并锁定。',
  'add.added': '已添加',
  'add.toTargets': '添加到 {count} 个目标',

  'detail.aria': '技能 {name}',
  'detail.modelInvocable': '模型可调用',
  'detail.modelBlocked': '模型不可调用',
  'detail.userInvocable': '用户可调用',
  'detail.userBlocked': '用户不可调用',
  'detail.whenToUse': '使用时机：{text}',
  'detail.close': '关闭',

  'error.loadDetail': '无法加载技能详情',

  'warning.partialAdd': '已添加到 {total} 个目标中的 {added} 个；首个失败：{first}',

  'status.working': '处理中…',
}
