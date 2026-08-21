# dst-desktop-ht 定制与构建说明

> 面向内部分发维护者。记录本仓库相对上游 [anywhere-labs/deepseek-harness-desktop](https://github.com/anywhere-labs/deepseek-harness-desktop) 的全部定制、打包流水线的关键约束，以及验证方法。

## 一、定制内容总览

| 定制 | 位置 | 说明 |
|---|---|---|
| 预装 dsh-better-sidebar | `dsh-plugin-desktop/cordis.patch.yml` insert 行 + 应用依赖 | 右侧栏工作台，npm 依赖直引 |
| HTSC AI 首启引导 | `packages/htscai-onboarding/`（自研插件）+ insert 行 | 首启弹窗：验证密钥 → 查询模型 → 勾选写入配置 |
| 官方 DeepSeek 源替换为 HTSC AI 网关 | `cordis.patch.yml` 顶层行 | 禁用 `llm-deepseek`；在 `llm-pi-ai` 声明 htscai 路由（openai-completions + HTSCAI_API_KEY 引用 + 内网 baseURL，占位模型由首启引导替换） |
| 预装 dsh-automation 定时任务 | `vendor/dsh-external-dsh-automation-0.1.6.tgz` + insert 行 | 不在 npm 上，vendored tarball 引入 |

## 二、打包流水线的关键约束（踩坑记录）

### 1. 单一构建路径——最重要的约束

`dist:win` 内部只构建 `dsh-plugin-desktop` 一个 workspace。预装插件的 `lib/` 必须在那一次构建里产出，否则安装包只带插件源码、启动即报 `Cannot find module .../lib/index.js` 闪退。

**正确做法（当前状态）**：插件构建收编进应用的 build 脚本——

```diff
# dsh-plugin-desktop/package.json
- "build": "node scripts/generate-mac-app-icon.mjs && ...",
+ "build": "yarn workspace dsh-htscai-onboarding build && node scripts/generate-mac-app-icon.mjs && ...",
```

**错误做法（勿用）**：在 CI 的 win 任务里、`dist:win` 之前再加一步根目录 `yarn build`。这会让应用被构建两次，第二次构建与 electron-builder 的文件收集产生写冲突，**把安装包内层 `app-64.zip` 中 Electron 自身二进制写坏**——强管控机器上表现为 NSIS 完整性校验失败、跳过校验后解压失败。此损坏用外层 7z 测试和文件哈希都验不出来（见第三节验证方法）。

规则：**任何预装插件要进包，就挂进 `dsh-plugin-desktop` 的 build 脚本；CI 里每个平台只许一次构建。**

### 2. 跨平台 lockfile 稳定

`file:` 目录依赖会被 yarn 对内容做哈希，Windows 检出的 CRLF 换行会让哈希与 macOS/Linux 不一致，`yarn install --immutable` 在 CI 直接失败。因此 vendored 插件一律提交**打包好的 .tgz**（`.gitattributes` 里标 `binary`），不要提交目录。

### 3. vendored 插件的隐式依赖

第三方插件常 import `@deepseek-ai/*` 宿主包而不声明。在根 `.yarnrc.yml` 的 `packageExtensions` 里以 **peerDependencies** 补齐（版本对齐应用内已有的），让它们复用应用的单例副本，不要在 vendor 目录里改源码。

## 三、出包后验证（每次必做）

```sh
# 1. 内层载荷完整性（外层通过不算数）
7z e DSH-Desktop-2.0.7-x64-Setup.exe '$PLUGINSDIR/app-64.zip' -oout
7z t out/app-64.zip        # 期望 Everything is Ok

# 2. CI 冒烟：win 任务的 Smoke-install 步骤已在纯净 Windows 上真实静默安装

# 3. 哈希核对（Release 页 SHA256SUMS.txt 同步更新）
certutil -hashfile <安装包> SHA256   # Windows
shasum -a 256 <安装包>               # macOS
```

## 四、分发说明（给同事）

1. 下载：https://github.com/WilShi/dst-desktop-ht/releases/latest
2. macOS：DMG 未签名，首次打开右键 → 打开；首启弹「访问文稿文件夹」点允许
3. Windows：优先用 **zip 绿色版**（解压即用）；NSIS 安装包也可正常安装，极少数强管控机器若拦安装器，换 zip 即可
4. 首次启动：HTSC AI 密钥弹窗 → 输密钥 →「保存并查询可用模型」→ 勾选 →「加入配置」
5. 自行加插件：应用内终端 `dsh plugin --profile desktop add <包名>`

## 五、同步上游 / 同步本机

```sh
git fetch upstream                       # upstream = anywhere-labs 原版
git merge upstream/master                # 或 rebase；冲突面预期只在上述定制文件
git pull origin master                   # 本机克隆同步
yarn install --immutable && yarn build   # 一条命令重建（插件会自动先构建）
```

## 六、换目录重装后打不开（Windows）

症状：新装/换目录安装后启动即退（"Cannot find module .../dsh-htscai-onboarding/lib/index.js" 或 crashpad not connected）。

原因：应用的模块镜像 `%USERPROFILE%\.dsh\profiles\node_modules` 里是**指向上次安装目录的联接（junction）**。换了安装目录后联接悬空，宿主按镜像解析预装插件即失败。

处置（一条命令，应用下次启动会自动重建镜像）：

```cmd
rmdir /s /q "%USERPROFILE%\.dsh\profiles\node_modules"
```

纯净安装（全新机器）不受影响；zip 绿色版换目录时同样适用此条。
