# ZCode 社区构建

独立公开仓库 **LeeXieXie/zcode-releases**，跟踪 [zai-org/ZCode](https://github.com/zai-org/ZCode) 的公开源码并通过 GitHub Actions 打包安装文件。**这是非官方社区构建，不是 Z.ai 官方分发，也不代表官方产品的全部功能。**

[下载安装包](https://github.com/LeeXieXie/zcode-releases/releases) · [查看构建日志](https://github.com/LeeXieXie/zcode-releases/actions/workflows/release.yml) · [上游源码](https://github.com/zai-org/ZCode)

仓库配置不等于成功发布记录；请以 Actions 实际结果及 Releases 中公开的附件为准。

## 下载与限制

| 平台 | 架构 | 安装文件 |
| --- | --- | --- |
| Windows | x64 | EXE |
| macOS | Apple Silicon ARM64 | DMG、ZIP |
| macOS | Intel x64 | DMG、ZIP |
| Linux | x64 | AppImage、DEB、RPM、pkg.tar.zst |

- 所有构建均**未签名、未公证**，Windows SmartScreen 或 macOS Gatekeeper 可能警告或阻止安装。本仓库不提供签名证书，也不提供关闭系统安全机制的绕过指引。
- 公开源码中的 **Computer Use 是占位实现，不可用**；打包成功不表示具备官方二进制中的对应能力。
- 保留上游官方服务端点。使用相关服务需要用户自行取得有效凭据、服务权限及相应模型访问权限；安装包不内置密钥，不代为开通服务。
- 保持上游**自动更新默认关闭**；后续社区构建请从本仓库 Releases 获取。
- 构建与打包检查不等于桌面完整功能测试，也不证明已登录的模型会话可用。

## ZcodePro 功能对齐

已按固定提交对比 [luxi233/ZcodePro](https://github.com/luxi233/ZcodePro)：它列出的 **13 个插件在官方 3.16.2 源码中均已存在**，四个文档插件版本还更新。保留新版插件，不用旧资源覆盖降级；打包后额外检查技能、MCP 和文档查看器资源，报告随安装包发布。

**Computer Use 尚不能宣称补齐**：ZcodePro 的 Windows Helper 默认放开本地客户端身份校验，源码警告任意本地进程可能驱动电脑操作；原生组件的再分发许可与可重建来源证据也不足。macOS 安装脚本还修改签名信任校验。本仓库不会把这些步骤悄悄接入默认公开发行，也不会运行其脚本更改用户安全设置。完整比较、版本表与接入条件见 [功能审计](docs/zcodepro-assessment.md)。

## 同步与发布

源码作为 [`upstream`](upstream) Git submodule 引入，来源是 `zai-org/ZCode` 的 `main`。每次构建锁定完整提交 SHA，而非在构建途中继续追踪分支。

- 每 6 小时检查一次：cron 为 `17 */6 * * *`（UTC），对应北京时间 **08:17、14:17、20:17、次日 02:17**。GitHub 定时任务可能延迟。
- 相同源码 SHA 对应的 Release 已公开时跳过；手动强制重建除外。
- 四个目标全部构建成功、安装文件完整且上传完成后，才将 draft Release 公开。失败不会发布不完整的公开版本；Actions 保留已上传产物及日志供排查，上传中断时可能保留草稿。
- 标签格式为 `v<版本>-upstream.<SHA 前 12 位>`，例如 `v3.16.2-upstream.3c5b22764937`。
- Release 附带 `SHA256SUMS.txt`、`build-provenance.json` 及上游许可材料。前者用于核对文件 SHA-256；后者记录完整上游 SHA、版本、工具版本、构建来源和安装文件哈希。

维护者可在 Actions 的 **Community Releases → Run workflow** 手动触发 `workflow_dispatch`：

| 输入 | 默认值 | 含义 |
| --- | --- | --- |
| `source_ref` | `main` | 上游分支、标签或完整提交 SHA |
| `force` | `false` | 布尔值；设为 `true` 可重建已发布的源码快照 |

只有 `source_ref=main` 的同步会更新本仓库 main 分支记录的 submodule gitlink。手动构建历史 ref 不会把 main 的 gitlink 倒退到历史版本。

## 构建边界

不修改上游应用或运行时源码。构建前对已知构建脚本位置应用精确补丁：强制 `electron-builder --publish never`，禁止隐式发布；保护 Visualize 的 vendor 快照，避免上游 sourcemap 清理改写文件却未更新哈希、导致功能加载失败。匹配失败则停止，等待人工审查。仍执行上游打包入口末尾的运行时依赖检查和 bundle 大小审计，保留 vendor 原始哈希验证，不绕过审计直接调用打包器。

Node.js 和 pnpm 从该源码快照的 `mise.toml` 读取精确版本，并核对包元数据；当前快照为 **Node.js 24.14.0 / pnpm 10.33.2**。依赖安装使用冻结锁文件，不自动更新依赖。

## 本地检查与构建

克隆时初始化 submodule：

```sh
git clone --recurse-submodules https://github.com/LeeXieXie/zcode-releases.git
cd zcode-releases
```

仓库自身的检查不需要安装上游依赖，在仓库根目录运行：

```sh
node --test test/release.test.mjs test/features.test.mjs
node --check scripts/release.mjs
node --check scripts/verify-features.mjs
```

不要使用不带路径的 `node --test`：它可能递归进入 `upstream`，误运行上游测试。

完整安装包请优先通过 Actions 在对应平台的原生 runner 构建。需要本地构建时，先安装 `upstream/mise.toml` 指定的工具版本和目标平台原生打包依赖，再按 [release.yml](.github/workflows/release.yml) 的构建步骤执行。Windows、macOS、Linux 不能视为可任意互相交叉打包；上游打包入口及输出位置见 [上游构建说明](upstream/README.md)。克隆及各平台完整构建步骤尚未在本机全部执行验证，不能将这些说明视为已成功生成安装包的证据。

## 许可证与第三方材料

仓库根目录 [LICENSE](LICENSE) 保留上游 Apache-2.0 标准原文。上游第三方依赖、复制内容及运行时组件另有各自许可，不能仅以根许可证推断所有发行内容的授权条件。

Release 附带 `LICENSE.txt`、`NOTICE.md`、`THIRD-PARTY-NOTICES.md`，以及从上游 [`third-party/README.md`](upstream/third-party/README.md) 复制的 `UPSTREAM-LICENSE-REVIEW.md`。上游明确记录了尚未补齐的第三方许可材料与来源证据；**打包成功、基础检查通过或材料随包保留，均不构成完整再分发许可合规审计**。使用或再分发前请审阅相关材料及未解决条目。
