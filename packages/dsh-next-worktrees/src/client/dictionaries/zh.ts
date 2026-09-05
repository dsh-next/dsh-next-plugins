/**
 * Simplified Chinese mirror of this plugin's locale namespace.
 *
 * Same key set as en.ts — `Record<MessageKey, string>` makes a missing or
 * extra key a compile error. Add the Chinese copy alongside every new en key
 * in the same change (`pnpm i18n:check` enforces it repo-wide).
 */
import type { MessageKey } from './en.ts'

/** The zh mirror: same keys, Simplified Chinese copy. */
export const zh: Record<MessageKey, string> = {
  'row.facts.branch': '分支',
  'row.facts.status': '状态',
  'status.clean': '无改动',
  'status.dirty': '有未提交改动',
  'status.ahead': '领先 {count} 个提交',
  'status.merged': '已合并',
  'row.refresh': '刷新',
  'row.merge': '合并…',
  'row.delete': '删除工作树…',
  'merge.title': '合并工作树',
  'merge.summary': '将 {source} 合并到 {target}',
  'merge.ff': '快进合并（不产生合并提交）',
  'merge.commit': '将产生一个合并提交',
  'merge.blocker.dirtyPrimary': '主检出存在未提交的更改。请先提交或贮藏。',
  'merge.blocker.dirtyWorktree': '工作树存在未提交的更改。请先在工作树会话中提交。',
  'merge.blocker.running': '此工作树中有一个会话正在运行。请停止或等待其完成。',
  'merge.blocker.conflict': '合并会产生冲突。请手动处理：{command}',
  'merge.blocker.oldGit': '一键合并需要 git 2.38 或更高版本。请手动执行 {command}。',
  'merge.done.title': '已合并到 {target}',
  'merge.done.cleanup': '移除该工作树？',
  'merge.done.keep': '保留',
  'merge.done.remove': '移除工作树',
  'delete.confirm.title': '删除工作树',
  'delete.confirm.body': '分支 {branch} 与会话记录会保留；工作副本将被删除。',
  'delete.confirm.dirty': '此工作树存在未提交的更改。',
  'delete.confirm.ok': '移除工作树',
  'delete.confirm.force': '仍要移除',
  'delete.confirm.cancel': '取消',
  'create.title': '在 {repo} 中新建工作树',
  'create.error.title': '无法创建工作树',
  'create.error.hint': '未做任何更改；请先解决上述问题，然后重试。',
  'create.error.ok': '好',
  'create.cancel': '取消',
}
