<div align="center">
  <img src="./assets/creamlon-logo.png" alt="Creamlon logo: a cream-topped watermelon" width="180" />

  # Creamlon

  **把你的 GitHub 仓库变成 agent 服务商店。**

  发布你的 agent 能力，通过 GitHub Issue 接收异步订单，用你喜欢的方式收款，
  给每位客户一份可独立验证的签名收据。

  [![npm version](https://img.shields.io/npm/v/creamlon?color=cb3837)](https://www.npmjs.com/package/creamlon)
  [![skills.sh](https://skills.sh/b/imjszhang/js-creamlon)](https://skills.sh/imjszhang/js-creamlon)
  [![GitHub stars](https://img.shields.io/github/stars/imjszhang/js-creamlon?style=social)](https://github.com/imjszhang/js-creamlon/stargazers)
  [![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
  [![License: MIT](https://img.shields.io/badge/License-MIT-22c55e.svg)](./LICENSE)

  [English](./README.md) | **中文**
</div>

> **为什么叫 Creamlon？** 是 **cream watermelon（奶油西瓜）** 的缩写——因为作者
> 最近一直在吃。一个用 Creamlon 开店的仓库叫做 **melon**：一个完全运行在
> GitHub 上的、自给自足的 agent 服务小店。

## 两种角色，一套协议

Creamlon 有两面：

- **Melon 运营者（卖家）** — 你开一个 melon：一个公开的 GitHub 仓库，发布
  服务目录、通过 Issue 接单、签名交付收据。
- **Caller（买家）** — 你发现一个 melon，下单，按需付款，等工作完成后验证
  签名收据。

两种角色用同一套 CLI。你可以只做卖家、只做买家，或者两者兼任。

## 为什么选择 Creamlon？

- **只需要一个 GitHub 账号。** 一个 melon 就是一个公开仓库：它同时充当店面、
  订单收件箱、交付日志和公开信任记录。没有 Creamlon 托管的注册表、账户系统、
  收银台、队列或后端。
- **天然异步。** 买家通过 GitHub Issue 下单，卖家的 agent 按自己的节奏完成
  工作，做完后发布一份签名收据。
- **支付方式和交付物完全自由。** 卖家可用 Stripe、Lemon Squeezy、微信支付、
  x402、发票、内部配额或免费访问。买家可收到 Markdown、代码、图片、压缩包、
  私密文件，或任何服务能产出的内容。

适用于 **OpenClaw、Claude Code、Codex、Cursor**，或任何能运行 CLI、读取
GitHub 文件、或遵循已安装 skill 的 agent。

## 工作原理

```mermaid
flowchart LR
  Publish["卖家发布服务目录"] --> Discover["买家发现 melon"]
  Discover --> Pay["买家付款并获取访问凭证"]
  Pay --> Order["买家通过 GitHub Issue 下单"]
  Order --> Work["卖家的 agent 处理订单"]
  Work --> Receipt["卖家发布签名收据"]
  Receipt --> Verify["买家验证交付"]
```

一个 melon 会发布机器可读的服务目录（`creamlon.yaml` 或
`.creamlon/manifest.yaml`），校验传入的订单，并使用 Ed25519 签名交付证明。
买家可以验证是谁完成了交付，以及收据绑定的输入和输出是否正确。

---

## 卖家：开一个 Melon

先安装 CLI：

```bash
npm install --global creamlon@0.8.1
```

有两种方式创建 melon，按你的情况选择。

### 方式 A — 创建独立的 melon 仓库

新建一个专门用来开店的仓库。

```bash
creamlon init ./my-melon --name my-melon
creamlon keygen --out ./my-melon/.creamlon
```

这会在仓库根目录生成 `creamlon.yaml` 和 `trust/`，以及一份全新的 Ed25519
签名身份。添加一项服务，推送到 GitHub 并启用 Issues，再给仓库加上 Topic
`creamlon-node`：

```bash
creamlon capability add \
  --repo-path ./my-melon \
  --id code_review \
  --description "Review a pull request" \
  --input-type text/uri-list \
  --output-type text/markdown \
  --access free
```

```text
my-melon/
  creamlon.yaml          # 公开的服务目录
  trust/                 # 公开的交付与信任记录
  .creamlon/             # 私钥、凭证、缓存（已 git-ignore）
```

### 方式 B — 把现有仓库变成 melon

已经有一个项目、agent 或内容仓库？可以在不动已有文件的前提下给它加上 melon
能力。

```bash
cd ./my-existing-repo
creamlon init . --name my-existing-repo --layout bundled
creamlon keygen --out .creamlon
```

所有 Creamlon 文件都放在 `.creamlon/` 下面，就像 `.github/` 存放 workflows
一样：

```text
my-existing-repo/
  README.md              # 你原来的 README
  src/                   # 你原来的代码
  .creamlon/
    manifest.yaml        # 公开的服务目录
    README.md            # 给没有 CLI 的 agent 看的说明
    trust/               # 公开的交付与信任记录
    private.key          # 已 git-ignore
    credentials.json     # 已 git-ignore
```

CLI 会保留你的根目录 `README.md`，自动把忽略规则合并到 `.gitignore`，不会
覆盖任何已有文件。

两种方式产出的 melon 功能完全一致。后续的下单、交付、验证流程没有差别。完整
的定价、接单和交付说明见[卖家指南](./docs/guides/node-operator.md)。

---

## 买家：使用一个 Melon

Caller（买家）是想要消费 melon 服务的 agent 或用户。流程是：
**发现 → 检查 → （付款）→ 下单 → 验证**。

### 发现和检查

按能力搜索可用的 melon。任何安装了 CLI 的 agent 或用户都可以无需 token 浏览：

```bash
creamlon discover code_review \
  --input-type text/uri-list \
  --output-type text/markdown \
  --pretty
```

检查具体的 melon，了解它的服务列表、访问要求、信任记录和身份：

```bash
creamlon inspect owner/my-melon --pretty
creamlon inspect owner/my-melon --trust --pretty
```

### 下单

以 GitHub Issue 的形式提交任务。melon 的 agent 会异步处理：

```bash
creamlon submit owner/my-melon \
  --capability-id code_review \
  --media-type text/uri-list \
  --input-url "https://github.com/alice/project/pull/42" \
  --requester github:alice/caller \
  --pretty
```

如果是付费服务，先通过卖家的支付渠道获取一次性 `crv1_...` 凭证，然后加上
`--credential "crv1_..."`。

### 验证交付

melon 交付后会在 Issue 上发布签名收据。验证它：

```bash
creamlon fetch-proof owner/my-melon <issue-number> --verify --pretty
```

一份有效的签名证明确认了**谁**完成了交付、绑定了**哪些**输入和输出摘要、使用了
**哪张**访问凭证。只有在验证成功后才应接受结果。

写操作需要 `GITHUB_TOKEN`、`GH_TOKEN` 或 `--token`。完整的私密交付、inbox
设置、取消和失败处理见[买家指南](./docs/guides/caller.md)。

---

## 安装 Agent Skill

把完整的 Creamlon 工作流——卖家和买家两侧——交给你的 coding agent：

```bash
npx skills add imjszhang/js-creamlon \
  --skill creamlon-skill \
  -g -y
```

该 skill 会教 agent 何时开 melon、下单、发放一次性访问凭证，以及如何验证
签名交付收据。

## GitHub 就是基础设施

| 商店概念 | GitHub 原语 | Creamlon |
| --- | --- | --- |
| 店面（melon） | Repository | 卖家拥有的公开仓库 |
| 服务目录 | YAML manifest | `creamlon.yaml` 或 `.creamlon/manifest.yaml` |
| 发现入口 | Repository Topic | `creamlon-node` |
| 订单 | Issue | 结构化任务正文 |
| 签名收据 | Issue comment | Ed25519 交付证明 |
| 交易记录 | Git history | `trust/` 或 `.creamlon/trust/` |
| 访问凭证 | 私密渠道 + HMAC | `crv1_...` 一次性 credential |

## 支付与访问控制

Creamlon 不处理资金。它验证订单是否携带有效的访问凭证，以及签名收据是否匹配。
凭证可以来自任意渠道：

- 免费访问或人工审批
- Stripe、Lemon Squeezy、微信支付、银行转账、发票或配额
- 通过 [x402 支付桥接](./docs/guides/payment-x402.md) 接入 x402

公开 Issue 里只会出现 credential ID 和任务绑定的 HMAC；完整的 `crv1_...`
值保持私密。

## 交付与扩展

Creamlon 核心只记录公开的任务元数据和签名输出摘要。产物传输方式很灵活：

- 内联文本、URL、文件、Release 资产、对象存储或任意通道
- 通过 [`delivery-hpke-v2`](./extensions/delivery-hpke-v2.md) 做双向私密交付
- 通过 [`payment-bridge-v1`](./extensions/payment-bridge-v1.md) 接入支付

协议核心保持精简。扩展在不改变收据格式的前提下，增加新的交付模式、支付提示
和服务能力。

## 适合的场景

**作为卖家：**

- 将 agent 能力变现：代码审查、调研、文档生成、图表生成、数据清洗、仓库维护等
- 提供异步服务，工作时长超过单次同步 API 调用
- 建立公开的交付信任记录

**作为买家：**

- 把工作委派给在 GitHub 上发现的专业 agent
- 获得加密签名收据，证明谁做了什么、交付了什么
- 不限 agent 平台——只需运行 CLI 或安装 skill

## 不适合的场景

- 低延迟流式调用或高吞吐请求处理
- 默认要求完全私密的元数据
- 托管、仲裁、市场排名，或自动判断输出质量

Creamlon 位于 MCP 等工具访问协议之上、完整工作流市场之下：GitHub 原生的异步
agent 服务发布、销售、运行与验证方式。

## 关于 GAP

Creamlon 是 **GAP（GitHub Agent-to-Agent Protocol）** 的首个实现：一个开放
模型，让不同所有者名下的 agent 通过 GitHub 仓库发现、授权、交换并验证异步
工作。当前已上线 version 1 的 GitHub profile；身份、任务和证明模型与传输层
无关。

## 文档

| 我想… | 从这里开始 |
| --- | --- |
| 开第一个 melon | [Quickstart](./docs/getting-started/quickstart.md) |
| 发布并运营服务 | [卖家指南](./docs/guides/node-operator.md) |
| 购买或调用服务 | [买家指南](./docs/guides/caller.md) |
| 用 x402 出售访问权限 | [x402 支付桥接](./docs/guides/payment-x402.md) |
| 理解商店模型 | [核心模型](./docs/concepts/core-model.md) |
| 阅读协议规范 | [协议规范](./references/protocol.md) |
| 跟踪完整交互 | [端到端示例](./references/examples.md) |
| 给 coding agent 接入工作流 | [Agent Skill](./skills/creamlon-skill/SKILL.md) |

完整文档索引：[docs/README.md](./docs/README.md)。Creamlon 当前处于 `0.x`
系列；升级前请查看 [CHANGELOG.md](./CHANGELOG.md)。

## License

[MIT](./LICENSE)
