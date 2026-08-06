# dsh-drag-and-drop — 文件拖拽路径插件

DeepSeek Harness Web UI 插件：把文件拖入页面任意位置，将文件原始绝对路径插入当前会话输入框。

插件不会上传、移动或复制文件，不会破坏文件所在目录与相邻依赖文件之间的关系。

发布于 [dsh-external](https://github.com/dsh-external) 组织 · 许可证 BSD-3-Clause

> 本组织为 DSH 内测社区仓库，官方不保证公开发布后该组织仍然存在，请自行保留副本。

## 实现能力

- 将文件拖入 Web UI 任意位置即可插入原始绝对路径
- 拖拽过程中显示全页面压暗和模糊提示
- 支持文件和文件夹，也支持一次拖入多个项目，每个路径占一行
- 支持 macOS、Linux 和 Windows 原生路径
- 支持 POSIX 路径、Windows 盘符路径和 UNC 网络路径
- 不上传、不移动、不复制文件
- 优先在当前 Workspace 和已注册 Workspace 中定位文件
- 浏览器隐藏原始路径时，使用本地文件索引和受控目录搜索
- 仅在存在多个候选文件时计算内容指纹
- 多个完全相同的文件副本无法自动区分时，由用户选择路径
- 通过 DSH 的输入状态服务写入草稿，不直接修改输入框 DOM

## 安装

需要 DSH 源码环境（`scripts/install.sh` 安装的 checkout，默认位于 `~/.dsh/source/current`）。下面将它记作 `$DSH`。

### 1. 安装插件

```sh
cd $DSH
pnpm --filter @deepseek-ai/dsh add "github:dsh-external/dsh-drag-and-drop"
```

也可以先 clone，再通过本地路径安装：

```sh
cd $DSH
pnpm --filter @deepseek-ai/dsh add "file:/path/to/dsh-drag-and-drop"
```

仓库包含构建产物，安装后无需另外构建。

### 2. 启用插件

编辑 `~/.dsh/config.yaml`，加入：

```yaml
- insert:
    - id: drag-and-drop
      name: '@dsh-external/dsh-drag-and-drop'
```

这是个人配置覆盖层，不需要修改 DSH 仓库中的文件。

### 3. 重启 Web UI

使用你当前启动 DSH Web UI 的方式重新启动服务，然后刷新浏览器页面。

## 使用

把文件或文件夹从 Finder、Linux 文件管理器或 Windows 文件资源管理器拖入 DSH Web UI 的任意位置。

出现全页面拖拽提示后松开鼠标，插件会将定位到的原始绝对路径写入当前会话输入框。

一次拖入多个项目时，每个路径占一行。

## 路径定位

如果浏览器提供本地文件 URI，插件会直接转换为当前操作系统的原生路径。

如果浏览器出于安全原因隐藏原始路径，插件按以下顺序定位文件：

1. 当前 Workspace
2. 其他已注册 Workspace
3. Desktop、Documents 和 Downloads
4. 操作系统文件索引
5. 有边界限制的平台目录搜索

不同平台使用的系统索引：

- macOS：Spotlight
- Linux：优先使用 `plocate`，其次使用 `locate`
- Windows：优先使用 Everything CLI，其次使用 PowerShell

Linux 在系统索引没有返回候选时，还会搜索用户主目录以及 `/mnt`、`/media` 下的挂载目录。

Windows 在系统索引没有返回候选时，还会搜索用户目录和可用的固定磁盘。

为了避免无边界搜索：

- 单次外部索引命令的超时时间为 3 秒
- 最多保留 100 个候选路径
- 每个递归搜索根最多访问 20,000 个目录项
- 无法读取的目录和文件会被忽略

## 候选确认

候选文件首先通过以下信息筛选：

- 完整文件名
- 文件大小

修改时间只用于候选排序，不作为文件身份依据。

如果只剩一个候选，插件会直接使用该路径，不读取文件内容。

如果存在多个候选，插件会比较文件开头、中间和结尾的采样指纹。大文件的采样指纹仍然冲突时，才会计算完整 SHA-256。

如果多个路径对应完全相同的文件内容，插件会显示路径列表，由用户选择需要插入的路径。

文件夹首次只按名称搜索。唯一候选会直接返回，不遍历浏览器目录；多个同名候选才比较排序后的相对路径、项目类型和文件大小。结构相同的多个目录会进一步对最多 24 个确定性选择的文件计算内容采样；仍然相同则由用户选择路径。目录遍历最多处理 10,000 个项目和 32 层，不跟随符号链接或 Windows junction。

每一层搜索都先检查搜索根的直接子项，再查询该范围内的操作系统索引，最后才递归目录。当前 Workspace、其他 Workspace 和常用目录的优先级保持不变。

## 隐私和文件访问

插件不会：

- 上传文件
- 复制文件
- 移动文件
- 修改文件
- 删除文件

多数情况下，插件只读取文件元数据。

只有存在多个同名、同大小候选文件时，才会读取少量文件内容计算采样指纹。仅在大文件采样仍然无法区分时，才会读取完整内容计算 SHA-256。

所有定位和指纹计算都在运行 DSH 的本机完成。

## 平台说明

### macOS

支持 Finder 拖拽和 Spotlight 索引。已在 macOS Chrome 环境验证。

### Linux

支持提供 `text/uri-list` 的文件管理器。浏览器隐藏路径时，插件使用 Workspace、常用目录、`plocate`、`locate` 和受控挂载目录搜索。

建议安装 `plocate`，以获得更快的全局路径定位。

### Windows

支持盘符路径和 UNC 网络路径。浏览器隐藏路径时，插件优先使用 Everything CLI；未安装 Everything 时，使用 PowerShell搜索用户目录和固定磁盘。

安装 Everything 及其命令行工具可以显著提高大磁盘上的定位速度。

## 卸载

```sh
cd $DSH
pnpm --filter @deepseek-ai/dsh remove @dsh-external/dsh-drag-and-drop
```

然后删除 `~/.dsh/config.yaml` 中对应的插件配置，并按你当前的方式重启 DSH Web UI。

## 开发

构建脚本需要可用的 DSH checkout。默认会从 `dsh` 命令定位，也可以显式指定：

```sh
DSH_CHECKOUT=/path/to/dsh pnpm run build
```

运行测试：

```sh
pnpm test
```

执行类型检查：

```sh
pnpm run check
```

构建：

```sh
pnpm run build
```

## License

BSD-3-Clause
