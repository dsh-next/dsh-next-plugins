/**
 * Panel dictionaries for the DSH `locale` service.
 *
 * `en` is the key source (English is the fallback locale and this repo's
 * language); `zh` mirrors every key, enforced by its type. Values may carry
 * `{name}` placeholders — the platform's `t(key, params)` substitutes them,
 * and {@link englishTranslate} mirrors that interpolation for compositions
 * without the locale service (the panel then renders English unchanged).
 *
 * English values are byte-identical to the strings this panel rendered
 * before localization, so English-language tests assert the same text.
 */

/** Dictionary namespace this panel owns (also the slot label's namespace). */
export const NS = 'cc-plugins'

export const en = {
  'nav': 'Claude Plugins',
  'tab.plugins': 'Plugins',
  'tab.marketplaces': 'Marketplaces',
  'tab.models': 'Models',

  'search.placeholder': 'Search plugins…',
  'provider.aria': 'Marketplace',
  'provider.all': 'All marketplaces',
  'filter.installedOnly': 'Installed only',

  'empty.noMarketplacesPlugins': 'No marketplaces added yet. Add one in the Marketplaces tab (owner/repo GitHub shorthand, a GitHub URL, or a local path).',
  'empty.noMatch': 'No plugins match the current filters.',
  'empty.noMarketplacesSources': 'No marketplaces added yet. Add one with an owner/repo GitHub shorthand, a GitHub URL, or a local path.',

  'card.noDescription': 'no description',
  'card.notInstallable': 'not installable: {reason}',
  'card.resolveOnInstall': 'components resolve on install',
  'card.installedVersion': 'installed {version}',
  'card.noteCount.one': '{count} install note',
  'card.noteCount.many': '{count} install notes',
  'card.detailsTitle': 'details for {key}',
  'card.updateTitle': 'update {key} to {version}',
  'card.update': 'Update',
  'card.manage': 'Manage',
  'card.add': 'Add',

  'summary.skill.one': '{count} skill',
  'summary.skill.many': '{count} skills',
  'summary.mcp.one': '{count} MCP server',
  'summary.mcp.many': '{count} MCP servers',
  'summary.command.one': '{count} command',
  'summary.command.many': '{count} commands',
  'summary.agent.one': '{count} agent tool',
  'summary.agent.many': '{count} agent tools',
  'summary.hook.one': '{count} hook event (enable runtime.hooks)',
  'summary.hook.many': '{count} hook events (enable runtime.hooks)',
  'summary.requires': 'requires: {deps}',
  'summary.noComponents': 'no components',

  'unbridged.prefix': 'not bridged: ',
  'unbridged.lsp.one': '{count} LSP server',
  'unbridged.lsp.many': '{count} LSP servers',
  'unbridged.monitors.one': '{count} monitor',
  'unbridged.monitors.many': '{count} monitors',
  'unbridged.outputStyles.one': '{count} output style',
  'unbridged.outputStyles.many': '{count} output styles',
  'unbridged.themes.one': '{count} theme',
  'unbridged.themes.many': '{count} themes',
  'unbridged.workflows.one': '{count} workflow',
  'unbridged.workflows.many': '{count} workflows',
  'unbridged.executables.one': '{count} executable',
  'unbridged.executables.many': '{count} executables',
  'unbridged.settings.one': '{count} settings file',
  'unbridged.settings.many': '{count} settings files',

  'presence.global': 'global',
  'presence.workspace': 'workspace',
  'presence.in': 'in {targets}',
  'presence.installed': 'installed',

  'sync.never': 'never',
  'sync.unknown': 'unknown',
  'sync.justNow': 'just now',
  'sync.minutesAgo': '{count}m ago',
  'sync.hoursAgo': '{count}h ago',
  'sync.daysAgo': '{count}d ago',

  'modal.aria': 'Manage plugin "{name}"',
  'modal.available': '{version} available',
  'modal.hint': 'Choose where to add it. Skills install per target; MCP servers, agents, commands, and hooks activate globally once. Targets already holding the plugin are marked and locked.',
  'modal.target.global': 'Global',
  'modal.added': 'added',
  'modal.confirm': 'Confirm',
  'modal.uninstall': 'Uninstall',
  'modal.cancel': 'Cancel',
  'modal.updateEverywhere': 'Update everywhere',
  'modal.addTargets': 'Add to {count} targets',

  'detail.aria': 'Plugin details "{name}"',
  'detail.version': 'version {version}',
  'detail.notInstalled': 'not installed',
  'detail.from': 'from {marketplace}',
  'detail.author': 'author',
  'detail.homepage': 'homepage',
  'detail.category': 'category',
  'detail.tags': 'tags',
  'detail.skills': 'skills',
  'detail.commands': 'commands',
  'detail.agents': 'agents',
  'detail.mcpServers': 'MCP servers',
  'detail.hookEvents': 'hook events',
  'detail.notBridged': 'not bridged',
  'detail.requires': 'requires',
  'detail.inventoryNotes': 'inventory notes',
  'detail.close': 'Close',

  'marketplaces.placeholder': 'owner/repo, a GitHub URL, or a local path',
  'marketplaces.add': 'Add marketplace',
  'marketplaces.refreshAll': 'Refresh all',
  'marketplaces.hint': 'Snapshots older than 24 hours refresh automatically when this panel opens; Refresh all forces it now. Update buttons appear when a marketplace carries a newer version than the installed one.',
  'marketplaces.pluginCount.one': '{count} plugin',
  'marketplaces.pluginCount.many': '{count} plugins',
  'marketplaces.lastSynced': 'last synced {age}',
  'marketplaces.by': 'by {owner}',
  'marketplaces.remove': 'Remove',

  'models.hint': "Map the Claude model names your agents use onto models this runtime offers. Unmapped names inherit the delegating session's model — the same default as Claude's `model: inherit` — and choosing inherit explicitly overrides a config-baseline mapping. Saving re-resolves installed agent rows without reinstalling; reload the profile to apply them.",
  'models.config': 'config',
  'models.selectAria': 'Model for {alias}',
  'models.inherit': 'Inherit session model',
  'models.save': 'Save model mappings',

  'import.skipped': '{count} import(s) from the settings file skipped on this machine (missing workspace names or sources): {items}. Add the workspace or install through the panel.',
}

/** Every dictionary key. */
export type MessageKey = keyof typeof en

/** The zh mirror: same keys, Simplified Chinese copy. */
export const zh: Record<MessageKey, string> = {
  'nav': 'Claude 插件',
  'tab.plugins': '插件',
  'tab.marketplaces': '市场',
  'tab.models': '模型',

  'search.placeholder': '搜索插件…',
  'provider.aria': '市场',
  'provider.all': '全部市场',
  'filter.installedOnly': '仅显示已安装',

  'empty.noMarketplacesPlugins': '还没有添加市场。请在“市场”标签页添加（owner/repo GitHub 简写、GitHub 链接或本地路径）。',
  'empty.noMatch': '没有符合当前筛选条件的插件。',
  'empty.noMarketplacesSources': '还没有添加市场。请使用 owner/repo GitHub 简写、GitHub 链接或本地路径添加。',

  'card.noDescription': '暂无描述',
  'card.notInstallable': '不可安装：{reason}',
  'card.resolveOnInstall': '组件在安装时解析',
  'card.installedVersion': '已安装 {version}',
  'card.noteCount.one': '{count} 条安装说明',
  'card.noteCount.many': '{count} 条安装说明',
  'card.detailsTitle': '查看 {key} 的详情',
  'card.updateTitle': '将 {key} 更新到 {version}',
  'card.update': '更新',
  'card.manage': '管理',
  'card.add': '添加',

  'summary.skill.one': '{count} 个技能',
  'summary.skill.many': '{count} 个技能',
  'summary.mcp.one': '{count} 个 MCP 服务器',
  'summary.mcp.many': '{count} 个 MCP 服务器',
  'summary.command.one': '{count} 个命令',
  'summary.command.many': '{count} 个命令',
  'summary.agent.one': '{count} 个 agent 工具',
  'summary.agent.many': '{count} 个 agent 工具',
  'summary.hook.one': '{count} 个钩子事件（需启用 runtime.hooks）',
  'summary.hook.many': '{count} 个钩子事件（需启用 runtime.hooks）',
  'summary.requires': '依赖：{deps}',
  'summary.noComponents': '没有组件',

  'unbridged.prefix': '未桥接：',
  'unbridged.lsp.one': '{count} 个 LSP 服务器',
  'unbridged.lsp.many': '{count} 个 LSP 服务器',
  'unbridged.monitors.one': '{count} 个监视器',
  'unbridged.monitors.many': '{count} 个监视器',
  'unbridged.outputStyles.one': '{count} 个输出样式',
  'unbridged.outputStyles.many': '{count} 个输出样式',
  'unbridged.themes.one': '{count} 个主题',
  'unbridged.themes.many': '{count} 个主题',
  'unbridged.workflows.one': '{count} 个工作流',
  'unbridged.workflows.many': '{count} 个工作流',
  'unbridged.executables.one': '{count} 个可执行文件',
  'unbridged.executables.many': '{count} 个可执行文件',
  'unbridged.settings.one': '{count} 个设置文件',
  'unbridged.settings.many': '{count} 个设置文件',

  'presence.global': '全局',
  'presence.workspace': '工作区',
  'presence.in': '位于 {targets}',
  'presence.installed': '已安装',

  'sync.never': '从未',
  'sync.unknown': '未知',
  'sync.justNow': '刚刚',
  'sync.minutesAgo': '{count} 分钟前',
  'sync.hoursAgo': '{count} 小时前',
  'sync.daysAgo': '{count} 天前',

  'modal.aria': '管理插件“{name}”',
  'modal.available': '{version} 可更新',
  'modal.hint': '选择添加位置。技能按目标分别安装；MCP 服务器、agent、命令和钩子为插件级，全局只启用一次。已安装该插件的目标会被标记并锁定。',
  'modal.target.global': '全局',
  'modal.added': '已添加',
  'modal.confirm': '确认',
  'modal.uninstall': '卸载',
  'modal.cancel': '取消',
  'modal.updateEverywhere': '全部更新',
  'modal.addTargets': '添加到 {count} 个目标',

  'detail.aria': '插件详情“{name}”',
  'detail.version': '版本 {version}',
  'detail.notInstalled': '未安装',
  'detail.from': '来自 {marketplace}',
  'detail.author': '作者',
  'detail.homepage': '主页',
  'detail.category': '分类',
  'detail.tags': '标签',
  'detail.skills': '技能',
  'detail.commands': '命令',
  'detail.agents': 'agent 定义',
  'detail.mcpServers': 'MCP 服务器',
  'detail.hookEvents': '钩子事件',
  'detail.notBridged': '未桥接',
  'detail.requires': '依赖',
  'detail.inventoryNotes': '清单说明',
  'detail.close': '关闭',

  'marketplaces.placeholder': 'owner/repo、GitHub 链接或本地路径',
  'marketplaces.add': '添加市场',
  'marketplaces.refreshAll': '全部刷新',
  'marketplaces.hint': '超过 24 小时的快照会在面板打开时自动刷新；“全部刷新”立即执行。市场版本高于已安装版本时会出现“更新”按钮。',
  'marketplaces.pluginCount.one': '{count} 个插件',
  'marketplaces.pluginCount.many': '{count} 个插件',
  'marketplaces.lastSynced': '上次同步：{age}',
  'marketplaces.by': '作者：{owner}',
  'marketplaces.remove': '移除',

  'models.hint': '将 agent 使用的 Claude 模型名映射到当前运行时实际提供的模型。未映射的名称会继承委派会话的模型（与 Claude 的 `model: inherit` 默认行为一致）；显式选择继承可覆盖配置基线中的映射。保存后会重新解析已安装的 agent 行，无需重新安装；重载配置后生效。',
  'models.config': '配置',
  'models.selectAria': '{alias} 使用的模型',
  'models.inherit': '继承会话模型',
  'models.save': '保存模型映射',

  'import.skipped': '{count} 条来自设置文件的导入在本机被跳过（缺少工作区名称或来源）：{items}。请添加对应工作区或通过面板安装。',
}

/** `{name}` substitution with the platform's semantics: unknown names stay. */
export function interpolate(template: string, params?: Record<string, string | number>): string {
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match)
}

/**
 * The no-locale fallback translator: English, with the same interpolation.
 * Keeps the panel fully functional in compositions without the service.
 */
export function englishTranslate(key: MessageKey, params?: Record<string, string | number>): string {
  return interpolate(en[key], params)
}
