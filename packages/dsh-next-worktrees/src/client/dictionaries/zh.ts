/**
 * Simplified Chinese dictionary — the mirror of en.ts.
 *
 * Same key set as en.ts — `Record<MessageKey, string>` makes a missing or
 * extra key a compile error. Placeholder semantics match the English side.
 */
import type { MessageKey } from './en.ts'

export const zh: Record<MessageKey, string> = {
  'toggle.label': '隔离',
  'toggle.busy': '正在创建工作树…',
  'toggle.retry': '重试',
  'toggle.untitled': '未命名',

  'modal.title': '在隔离工作树中开始？',
  'modal.description': '将为此会话创建一个 git 工作树和分支。',
  'modal.fullAccess': '工作树中的会话以完整文件访问权限运行，以便 git 写入共享仓库元数据。审批提示仍然保留。',
  'modal.draftStays': '草稿保留在当前会话；新会话从空白开始。',
  'modal.confirm': '创建并切换',
  'modal.cancel': '取消',

  'hint.ignore': '将 .dsh/ 加入 .gitignore，插件工作树将保持未跟踪。',
  'hint.dismiss': '忽略',
  'hint.copy': '复制',

  'chip.clean': '干净',
  'chip.dirty': '有未提交更改',
  'chip.error': '状态不可用',
  'chip.ahead': '领先 {count} 个提交',
  'chip.open': '工作树详情',

  'panel.branch': '分支',
  'panel.base': '基线',
  'panel.path': '路径',
  'panel.siblings': '同级工作树',
  'panel.siblings.none': '暂无其他工作树',
  'panel.siblings.running': '运行中',
  'panel.siblings.idle': '空闲',
  'panel.copyBranch': '复制分支名',
  'panel.copyMerge': '复制合并命令',
  'panel.copied': '已复制',
  'panel.newSession': '在此新建会话',
  'panel.newSession.busy': '会话运行中 — 请先停止',
  'panel.remove': '移除工作树',
  'panel.refresh': '刷新',

  'remove.title': '移除此工作树？',
  'remove.survives': '分支 {branch} 及其提交会保留；仅移除工作树目录。',
  'remove.dirty': '其中存在未提交或未跟踪的更改。',
  'remove.confirm': '移除',
  'remove.force': '仍要移除（丢弃更改）',
  'remove.cancel': '取消',

  'error.rpc': '工作树服务不可达（{status}）',
  'error.flow': '{message}',
  'error.create': '无法创建工作树：{message}',
}
