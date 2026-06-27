# @shodocan/opencode-hindsight

**Shodocan OpenCode Hindsight 插件** - 为 OpenCode AI 助手提供跨会话、跨项目的持久记忆功能。

> 这是 Shodocan 发布的 OpenCode 插件/集成包，不是原版 Vectorize Hindsight。Vectorize Hindsight 服务器仍然是需要单独部署的语义记忆后端；本包负责把 OpenCode agent 连接到 Hindsight 记忆。

Shodocan 版本增加了 agent 感知的项目 bank 路由、运行时 bank alias、可信 OpenCode tool context 路由、compaction 记忆路由、隐私安全日志，以及国内/离线部署说明。

您的 AI 助手会记住您告诉它的一切 - 跨越会话，跨越项目。

## 快速开始

### 1. 部署 Hindsight 服务器

[Hindsight](https://github.com/vectorize-io/hindsight) 是本插件必需的语义记忆后端。您需要先部署它：

**使用 Docker Compose（推荐）：**
本项目在 `deploy/` 目录中包含了一个预配置的 Docker Compose 配置，已集成 DeepSeek。

```bash
# 进入 deploy 目录
cd deploy/

# 从模板创建 .env，限制权限，然后手动编辑 API 密钥
cp .env.example .env
chmod 600 .env
${EDITOR:-nano} .env

# 启动 Hindsight 服务器
docker compose up -d
```

**配置说明：**
- Docker Compose 设置默认使用 DeepSeek 的推理模型 (`deepseek-reasoner`)
- 您需要从 [DeepSeek 平台](https://platform.deepseek.com/) 获取有效的 API 密钥
- DeepSeek 密钥是 Hindsight 后端的 LLM 密钥 (`HINDSIGHT_API_LLM_API_KEY`)，不是插件连接 Hindsight API 的鉴权密钥 (`HINDSIGHT_API_KEY`)
- 配置包含持久化卷挂载在 `~/.hindsight-docker`
- 服务器运行在端口 8888（Web 界面）和 9999（附加服务）

**使用 Docker（简单方式）：**
```bash
# 拉取最新的 Hindsight 镜像
docker pull ghcr.io/vectorize-io/hindsight:latest

# 在端口 8888 上运行 Hindsight 服务器，使用持久化存储
docker run -d \
  --name hindsight \
  -p 8888:8888 \
  -v hindsight_data:/data \
  ghcr.io/vectorize-io/hindsight:latest

```

> **国内用户**：如果无法访问 `ghcr.io`，可使用华为 SWR 镜像：
> ```bash
> docker pull swr.cn-north-4.myhuaweicloud.com/cn/hindsight:latest
> docker run -d \
>   --name hindsight \
>   -p 8888:8888 \
>   -v hindsight_data:/data \
>   swr.cn-north-4.myhuaweicloud.com/cn/hindsight:latest
> ```

**离线/无网络环境：**

在无网络环境下运行时，Hindsight 无法从 HuggingFace 下载 embedding 和 reranker 模型。可使用预下载的本地模型：

```yaml
# docker-compose.yml 补充配置
environment:
  HINDSIGHT_API_EMBEDDINGS_PROVIDER: local
  HINDSIGHT_API_EMBEDDINGS_LOCAL_MODEL: /home/hindsight/models/bge-m3
  HINDSIGHT_API_RERANKER_PROVIDER: local
  HINDSIGHT_API_RERANKER_LOCAL_MODEL: /home/hindsight/models/bge-reranker-v2-m3
volumes:
  - /path/to/your/models/bge-m3:/home/hindsight/models/bge-m3
  - /path/to/your/models/bge-reranker-v2-m3:/home/hindsight/models/bge-reranker-v2-m3
```

可从 [ModelScope](https://modelscope.cn) 或 [HuggingFace](https://huggingface.co) 在有网络的机器上预下载模型，然后挂载到容器中。默认模型为 `BAAI/bge-small-en-v1.5`（embedding，384维）和 `cross-encoder/ms-marco-MiniLM-L-6-v2`（reranker）。

> **注意**：如果数据库已初始化后更换 embedding 模型，需先清除旧数据：停止容器，执行 `rm -rf ~/.hindsight-docker`，再重新启动。

**验证部署：**
```bash
curl http://localhost:8888/health
# 预期响应：{"status":"healthy","database":"connected"}
```

### 2. 安装插件

**通过 npm 安装（推荐）：**

```bash
npm install -g @shodocan/opencode-hindsight
echo '{"plugin": ["@shodocan/opencode-hindsight"]}' > ~/.config/opencode/opencode.json
```

**从源码本地开发：**

```bash
git clone https://github.com/Shodocan/opencode-hindsight.git
cd opencode-hindsight
bun install
bun run build
echo '{"plugin": ["file://'$(pwd)'"]}' > ~/.config/opencode/opencode.json
```

这将：
- 安装 npm 包或克隆插件源代码
- 必要时安装依赖并在本地构建插件
- 在您的 OpenCode 配置中注册插件（npm 包名或 `file://` 本地路径）
- 创建用于代码库索引的 `/hindsight-init` 命令

**注意**：重启 OpenCode 以使更改生效。

### 3. 配置连接

如果您的 Hindsight 服务器不在 `localhost:8888` 上运行，请配置连接：

**使用环境变量：**
```bash
export HINDSIGHT_API_URL="http://localhost:8888"

# 可选：仅在 Hindsight 服务器需要 API 鉴权时设置
export HINDSIGHT_API_KEY="your-hindsight-api-key"
```

`HINDSIGHT_BASE_URL` 仍作为 `HINDSIGHT_API_URL` 的旧版 fallback 支持。

**使用配置文件：**
创建 `~/.config/opencode/hindsight.jsonc`：
```jsonc
{
  "baseUrl": "http://localhost:8888",
  "apiKey": "$HINDSIGHT_API_KEY"
}
```

如果配置文件包含凭据或内部服务地址，请限制权限：`chmod 600 ~/.config/opencode/hindsight.jsonc`。

### 4. 重启并验证

重启您的 OpenCode 会话并验证插件已加载：

```bash
opencode -c  # 应在可用工具中显示 'hindsight'
```

**测试插件：**
重启 OpenCode 后，请让 agent 保存一条测试记忆；如果您的 OpenCode UI 支持直接调用工具，也可以使用会话内的 `hindsight` 工具。`hindsight` 是 OpenCode agent 工具，不是 `opencode-hindsight` 终端命令。

高级 bank 路由配置（`agentProjectBanks`、`runtimeProjectBanks`、`bankAlias`）请参考英文 README 的 “Agent-Aware Project Banks” 和 “Runtime Bank Aliases” 部分。项目 bank 选择优先级为：匹配的 `agentProjectBanks` → `HINDSIGHT_PROJECT_BANK_ID` → `HINDSIGHT_BANK_ID` → allowlisted `bankAlias`/`runtimeProjectBanks` → `projectBank` → 自动生成的 `p_<project>_<hash>`。

## 功能特性

### 上下文注入

上下文注入在用户发送**新会话的第一条消息**时自动触发 — 而不是在 OpenCode 启动时。机制如下：

1. **检测**：`chat.message` hook 通过内存中的 Set 检查当前会话/项目 bank 组合是否已注入过上下文
2. **每个会话/项目 bank 仅首条消息**：如果 key 不在 Set 中，立即标记（防止同一会话后续消息重复注入）
3. **三个并行 API 调用**，使用用户消息作为搜索查询：
   - `getProfile(banks.user, userMessage)` — 通过语义搜索检索跨项目用户个人资料
   - `searchMemories(userMessage, banks.user)` — 通过语义搜索检索相关的用户范围记忆
   - `listMemories(banks.project, maxProjectMemories)` — 列出最新 N 条项目记忆（无相关性过滤，均显示 `[100%]` 相似度）
4. **格式化与注入**：结果格式化为 `[HINDSIGHT]` 上下文块，作为不可见的 synthetic `Part` 前置到消息中 — 用户不可见，仅 AI 模型可见

**注入时机总结：**

| 事件 | 行为 |
|---|---|
| OpenCode 启动 | 不注入 |
| 用户发送第一条消息 | hook 触发 → 注入完成 → 处理消息 |
| 用户发送第二条消息 | hook 触发但会话已标记 → 跳过注入 |

示例（AI 模型看到的内容）：

```
[HINDSIGHT]

User Profile:
- 偏好简洁回复
- TypeScript 专家

Project Knowledge:
- [100%] 使用 Bun 而非 Node.js
- [100%] 构建命令：bun run build

Relevant Memories:
- [82%] 缺少 .env.local 时构建失败
```

AI 助手自动使用此上下文 — 无需手动提示。

### 关键词检测

当您说 "记住"、"保存这个"、"不要忘记" 等关键词时，AI 助手会自动保存到记忆中。

### 代码库索引

运行 `/hindsight-init` 命令，让 AI 助手探索并记忆您的代码库结构、模式和约定。

### 预压缩

当上下文使用率达到 80% 容量时：
1. 触发 OpenCode 的总结功能
2. 将项目记忆注入到总结上下文中
3. 将会话总结保存为记忆

这确保了在压缩事件中保持对话上下文。

## 工具使用

`hindsight` 工具对 AI 助手可用：

| 模式      | 参数                                      | 描述       |
| --------- | ----------------------------------------- | ----------------- |
| `add`     | `content`, `type?`, `scope?`, `bankAlias?` | 存储记忆（异步） |
| `search`  | `query`, `scope?`, `limit?`, `bankAlias?` | 搜索记忆   |
| `profile` | `query?`                                  | 查看用户个人资料 |
| `list`    | `scope?`, `limit?`, `bankAlias?`          | 列出记忆     |
| `forget`  | `memoryId`, `scope?`, `bankAlias?`        | 删除记忆     |
| `help`    | 无                                        | 显示工具用法和已配置的 alias |

**作用域：** `user`（跨项目），`project`（默认）

**类型：** `project-config`, `architecture`, `error-solution`, `preference`, `learned-pattern`, `conversation`

**命名说明：** OpenCode 工具名必须是 `hindsight`，并通过 `mode` 参数选择操作，例如 `hindsight(mode: "search", query: "auth flow")`。不要调用 `hindsight_search`、`hindsight_recall`、`hindsight_retain` 等拆分名称。

`bankAlias?` 仅适用于项目范围操作，并且只能使用 `runtimeProjectBanks` 中显式允许的 alias；`scope: "user"`、`profile` 和 `help` 不支持 `bankAlias`。

### 重要注意事项：
- **`add` 操作默认是异步的**，以防止记忆处理期间超时
- **元数据值必须是字符串** - 非字符串值会自动转换
- **响应包括 `operationId`** 用于跟踪异步操作
- **记忆处理可能需要 30-60 秒**，用于复杂内容提取

## 配置

创建 `~/.config/opencode/hindsight.jsonc` 或 `~/.config/opencode/hindsight.json`：

```jsonc
{
  // Hindsight 服务器 URL (默认: http://localhost:8888)
  "baseUrl": "http://localhost:8888",

  // 可选：需要鉴权的 Hindsight 服务器 API key
  "apiKey": "$HINDSIGHT_API_KEY",

  // 记忆检索的最小相似度 (0-1, 默认: 0.6)
  "similarityThreshold": 0.6,

  // 每次请求注入的最大记忆数 (默认: 5)
  "maxMemories": 5,

  // 列出的最大项目记忆数 (默认: 20)
  "maxProjectMemories": 20,

  // 注入的最大个人资料事实数 (默认: 5)
  "maxProfileItems": 5,

  // 在上下文中包含用户个人资料 (默认: true)
  "injectProfile": true,

  // 当未设置 userBank/projectBank 时，存储库名称的前缀 (默认: "opencode")
  "bankPrefix": "opencode",

  // 可选：设置确切的用户存储库（覆盖自动生成的存储库）
  "userBank": "my-custom-user-bank",

  // 可选：设置确切的项目存储库（覆盖自动生成的存储库）
  "projectBank": "my-project-bank",

  // 可选：按 agent 名称或 glob 路由到不同项目 bank
  "agentProjectBanks": {
    "review-*": "proj-review",
    "tdd": "proj-tdd"
  },

  // 可选：允许单次工具调用使用的项目 bank alias
  "runtimeProjectBanks": {
    "other-repo": "proj-other-repo"
  },

  // 召回操作的最大令牌数 (默认: 4096)
  "maxTokens": 4096,

  // 召回操作预算：'low'、'mid' 或 'high' (默认: 'mid')
  "budget": "mid",

  // 记忆检测的额外关键词模式（正则表达式）
  "keywordPatterns": ["log\\s+this", "write\\s+down"],

  // 触发压缩的上下文使用率阈值 (0-1, 默认: 0.8)
  "compactionThreshold": 0.8
}
```

环境变量优先级：

1. URL：`HINDSIGHT_API_URL` → `HINDSIGHT_BASE_URL` → 配置文件 `baseUrl` → `http://localhost:8888`
2. API key：`HINDSIGHT_API_KEY` → `HINDSIGHT_API_TENANT_API_KEY` → 配置文件 `apiKey` → 未设置
3. 其他选项：配置文件 → 默认值

自动生成的 bank 名称：用户 bank 为 `{bankPrefix}_user_<hash>`；项目 bank 为 `p_<目录名>_<hash>`，其中项目 bank 使用固定 `p_` 前缀，不使用 `bankPrefix`。

## 故障排除

### 常见问题

1. **添加记忆时超时错误**
   - **原因**：Hindsight 服务器处理记忆提取需要 30-60 秒
   - **解决方案**：插件默认使用异步操作 (`async: true`)
   - **验证**：检查响应是否包含 `operationId` 而不是 `id`

2. **`hindsight` 工具不可用**
   - **原因**：插件未加载或配置不正确
   - **解决方案**：
     - 验证插件是否在 `~/.config/opencode/opencode.json` 中
     - 配置更改后重启 OpenCode
     - 检查 Hindsight 服务器是否运行：`curl http://localhost:8888/health`
   - **工具健康检查**：要求 agent 调用准确的 `hindsight` 工具，例如 `hindsight(mode: "search", scope: "project", query: "manual hindsight health check", limit: 1)`。如果返回 “No tool named hindsight”，说明插件未加载；如果返回鉴权错误，说明插件已加载但 Hindsight API 凭据不正确。

3. **元数据保存不正确**
   - **原因**：Hindsight API 要求所有元数据值必须是字符串
   - **解决方案**：插件自动转换非字符串值：
     - 数字/布尔值 → 字符串表示
     - 对象/数组 → JSON 字符串
     - Null/未定义 → 空字符串

4. **`list` 命令返回空结果**
   - **原因**：`listDocuments` API 可能不返回所有记忆
   - **解决方法**：使用 `search` 命令配合特定查询
   - **注意**：这是当前 Hindsight API 实现的限制

5. **记忆未出现在搜索结果中**
   - **原因**：异步处理可能仍在进行中
   - **解决方案**：等待 1-2 分钟以完成记忆整合
   - **验证**：检查 Hindsight 服务器日志了解处理状态

## 日志

```bash
# 插件日志
tail -f ~/.opencode-hindsight.log

# Hindsight 服务器日志（如果在本地运行）
# 请查看您的 Hindsight 服务器文档了解日志位置
```

## 许可证

MIT
