/**
 * Simplified Chinese mirror of the `checkpoints` locale namespace.
 */
import type { MessageKey } from './en.ts'

export const zh: Record<MessageKey, string> = {
  'view.changes': '检查点',

  'empty.title': '还没有检查点',
  'empty.body': '会话开始时会保存一个「会话开始」检查点，之后每一轮结束再保存一个。选中一行即可查看截至该时刻的文件变更。',

  'rail.label': '检查点',
  'row.turn': '第 {turn} 轮',
  'row.sessionStart': '会话开始',
  'row.rewind': '回退',
  'row.rewindAria': '回退到第 {turn} 轮',
  'row.rewindAriaStart': '回退到会话开始',
  'row.iconAria': '第 {turn} 轮',
  'row.iconAriaStart': '会话开始',
  'row.inProgress': '进行中',
  'row.inProgressAria': '第 {turn} 轮进行中',
  'rail.resize': '调整检查点栏宽度',

  'files.label': '文件',
  'files.empty': '到此检查点没有文件变更。',
  'files.closePreview': '关闭',
  'files.statAria': '新增 {added} 行，删除 {removed} 行',
  'files.added': '+{count}',
  'files.removed': '-{count}',

  'file.binary': '二进制文件，不以 diff 显示。',
  'file.tooLarge': '文件过大，无法显示 diff。',
  'file.invalidUtf8': '无效 UTF-8，不以 diff 显示。',
  'file.symlink': '符号链接，不以 diff 显示。',
  'file.directory': '目录，不以 diff 显示。',
  'file.timeout': 'Diff 超时，已跳过正文。',
  'file.deleted': '已删除',
  'file.created': '新建',
  'file.modified': '已修改',

  'banner': '已回退到此检查点。之后的消息不会再发给模型。',

  'modal.title': '请确认',
  'modal.body': '这会把文件恢复到那一时刻，并打开截断后的对话。之后的轮次不会出现在新会话里。',
  'modal.lost': '请注意：此检查点之后的所有更改都会丢失。',
  'modal.filesDelete': '将删除的文件',
  'modal.turns': '之后的 {count} 轮将不再发给模型。',
  'modal.dirty': '将被覆盖、且并非由 Agent 改动的脏路径',
  'modal.headMoved': '自该检查点以来 HEAD 已移动。文件会与检查点一致，之后的提交仍保留。若要让 git 历史也对齐，请自行 reset。',
  'modal.headMovedDetail': '检查点 {checkpoint} · 当前 {current}',
  'modal.cancel': '取消',
  'modal.rewind': '回退',
  'modal.confirm': '恢复此检查点',
  'modal.blocker.openTurn': '当前仍有一轮在进行。等它结束后再回退。',
  'modal.blocker.unrestorable': '有路径无法恢复（缺少快照或类型不可还原）。',
  'modal.error': '回退失败：{message}',

  'diff.copy': '复制',
  'diff.copied': '已复制',
  'diff.collapseAria': '折叠 diff',
  'diff.expandAria': '展开其余 {count} 行',
  'diff.collapse': '折叠',
  'diff.expandRest': '展开其余 {count} 行',
  'diff.files.one': '1 个文件',
  'diff.files.other': '{count} 个文件',
}
