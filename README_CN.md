# opencode-hindsight

**OpenCode 实现的 Hindsight 插件** - 为 OpenCode AI 助手提供跨会话、跨项目的持久记忆功能。

您的 AI 助手会记住您告诉它的一切 - 跨越会话，跨越项目。

## 快速开始

### 1. 部署 Hindsight 服务器

[Hindsight](https://github.com/vectorize-io/hindsight) 是本插件必需的语义记忆后端。您需要先部署它：

**使用 Docker Compose（推荐）：**
本项目在 `deploy/` 目录中包含了一个预配置的 Docker Compose 配置，已集成 DeepSeek。

```bash
# 进入 deploy 目录
cd deploy/

# 创建 .env 文件并设置您的 DeepSeek API 密钥
echo "HINDSIGHT_API_LLM_API_KEY=您的-deepseek-api-密钥" > .env
# 或者手动创建 .env 文件并设置 API 密钥

# 启动 Hindsight 服务器
docker compose up -d
```

**配置说明：**
- Docker Compose 设置默认使用 DeepSeek 的推理模型 (`deepseek-reasoner`)
- 您需要从 [DeepSeek 平台](https://platform.deepseek.com/) 获取有效的 API 密钥
- 配置包含持久化卷挂载在 `~/.hindsight-docker`
- 服务器运行在端口 8888（Web 界面）和 9999（附加服务）

**使用 Docker（简单方式）：**
```bash
# 拉取最新的 Hindsight 镜像
docker pull vectorizeio/hindsight:latest

# 在端口 8888 上运行 Hindsight 服务器，使用持久化存储
docker run -d \
  --name hindsight \
  -p 8888:8888 \
  -v hindsight_data:/data \
  ghcr.io/vectorize-io/hindsight:latest

```

**验证部署：**
```bash
curl http://localhost:8888/health
# 预期响应：{"status":"healthy","database":"connected"}
```

### 2. 安装插件

```bash
# 克隆 opencode-hindsight 仓库
git clone https://github.com/opencode-community/opencode-hindsight.git
cd opencode-hindsight

# 安装依赖
bun install

# 构建插件
bun run build

# 将插件链接到 OpenCode 配置
echo '{"plugin": ["file://'$(pwd)'"]}' > ~/.config/opencode/opencode.json
```

这将：
- 克隆插件源代码
- 安装所有必需的依赖项
- 在本地构建插件
- 在您的 OpenCode 配置中注册插件
- 创建用于代码库索引的 `/hindsight-init` 命令

**注意**：重启 OpenCode 以使更改生效。

### 3. 配置连接

如果您的 Hindsight 服务器不在 `localhost:8888` 上运行，请配置连接：

**使用环境变量：**
```bash
export HINDSIGHT_BASE_URL="http://localhost:8888"
```

**使用配置文件：**
创建 `~/.config/opencode/hindsight.jsonc`：
```jsonc
{
  "baseUrl": "http://localhost:8888"
}
```

### 4. 重启并验证

重启您的 OpenCode 会话并验证插件已加载：

```bash
opencode -c  # 应在可用工具中显示 'hindsight'
```

**测试插件：**
```bash
# 尝试添加测试记忆
hindsight add content="测试记忆" type="preference" scope="project"
```

## 功能特性

### 上下文注入

在第一条消息时，AI 助手会接收（对用户不可见）：
- 用户个人资料（跨项目偏好）
- 项目记忆（所有项目知识）
- 相关的用户记忆（语义搜索）

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

| 模式      | 参数                         | 描述       |
| --------- | ---------------------------- | ----------------- |
| `add`     | `content`, `type?`, `scope?` | 存储记忆（异步） |
| `search`  | `query`, `scope?`            | 搜索记忆   |
| `profile` | `query?`                     | 查看用户个人资料 |
| `list`    | `scope?`, `limit?`           | 列出记忆     |
| `forget`  | `memoryId`, `scope?`         | 删除记忆     |

**作用域：** `user`（跨项目），`project`（默认）

**类型：** `project-config`, `architecture`, `error-solution`, `preference`, `learned-pattern`, `conversation`

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

  // 记忆检索的最小相似度 (0-1, 默认: 0.6)
  "similarityThreshold": 0.6,

  // 每次请求注入的最大记忆数 (默认: 5)
  "maxMemories": 5,

  // 列出的最大项目记忆数 (默认: 10)
  "maxProjectMemories": 10,

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
