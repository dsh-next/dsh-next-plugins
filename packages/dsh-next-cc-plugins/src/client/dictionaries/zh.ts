/**
 * Simplified Chinese mirror of the `cc-plugins` namespace.
 *
 * Same key set as `en.ts` — the `Record<MessageKey, string>` annotation makes
 * a missing or extra key a compile error. Terminology follows the bridge's
 * shipped glossary (插件/市场/安装/更新/技能/钩子/设置/宿主/全局/模型映射);
 * proper nouns and on-screen literals of third-party tooling stay English.
 */
import type { MessageKey } from './en.ts'

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
  'modal.hint': '选择此插件生效的范围。技能按所选范围安装；MCP 服务器、agent、命令和钩子为插件级，无论范围如何都只启用一次。',
  'modal.scope.global': '全局（所有工作区）',
  'modal.scope.workspaces': '选定的工作区',
  'modal.workspaces.hint': '插件仅在勾选的工作区中生效。',
  'modal.workspaces.empty': '尚未注册任何工作区。',
  'modal.workspaceMissing': '未注册',
  'modal.save': '保存范围',
  'modal.update': '更新',
  'modal.uninstall': '卸载',
  'modal.confirmUninstall': '确认卸载',
  'modal.cancel': '取消',

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

  'import.skipped': '{count} 条来自设置文件的导入在本机被跳过（缺少工作区名称或来源）：{items}。请注册对应工作区或通过面板安装。',
}
