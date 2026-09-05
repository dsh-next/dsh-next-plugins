# worktrees

[English](README.md) | 中文

在 DeepSeek Harness 侧边栏中嵌套展示 git worktree，并提供带预检的一键合并。
在同一个仓库上并行运行多个 agent 会话而不互相冲突：每个 worktree 拥有独立
的检出与分支，侧边栏把每个 worktree 会话显示在其所属仓库的分组内，而不是
一个独立的工作区。

## 功能

- **从仓库行创建。** 仓库行 `+` 旁的分支图标按钮打开创建弹窗，询问 worktree
  名称（预填自动生成的建议；名称仅用作显示标题 —— 分支名始终保持自动生成）。
  确认后创建 worktree、在其中打开会话，并绑定会话沙箱，使 git 在 linked
  worktree 中可用。
- **嵌套行。** worktree 会话渲染在其仓库分组之下，带分支标识（标题与
  dirty/ahead/merged 状态），比仓库自身的会话行多一层缩进。插件启用期间，
  原本独立的工作区行被隐藏。
- **行菜单。** 会话行的 `...` 菜单新增刷新、合并…、删除工作树…。删除会说明
  什么会保留（分支与会话记录保留；工作副本删除），脏工作树需要额外确认。
- **带预检的合并。** 合并… 在执行前完成全部预检：主检出干净、worktree 已
  全部提交、没有运行中的会话、以及冲突试算（`git merge-tree`，git 2.38+）。
  任何阻碍都会给出修复指引；冲突与旧版 git 会回退为给出精确的手动命令。
  预检全绿的合并就是一次 `git merge --no-edit`；完成后弹窗提供移除已合并
  worktree 的选项。

## 兼容性约定

- 需要 DSH `0.1.2-rc.1`。本插件在构建时从该精确版本的官方 client 派生工作区
  浏览器（版本 + SHA-256 双重校验）并在启用期间替换官方工作区 UI：DSH 的
  每次发布都需要本插件发布对应的重新派生版本。
- 与其他同样替换工作区浏览器的插件（例如 `dsh-git-worktree`）不兼容：两者
  修改同一个加载器条目。
- 本插件从不生成提交内容、从不 rebase、也从不解决冲突。它对检出的写入仅限
  worktree 的增删与带预检的合并。

## 安装

```sh
dsh plugin --profile <name> add link:<repo>/packages/dsh-next-worktrees
```

## 开发

```sh
pnpm build        # 派生浏览器、类型产出、打包两个半区
pnpm test         # 单元与契约测试
pnpm check:browser  # 复核派生校验门
```

设计规格：`docs/ideas/dsh-next-worktrees-sidebar-ux.md`。
