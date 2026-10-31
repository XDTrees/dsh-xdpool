/**
 * Chinese one-liners for the aggregate-provider page.
 *
 * The "notes" field of providers-registry.json is English on purpose: the
 * registry is copied verbatim from the upstream FCC directory, so its prose
 * stays aligned with that source and with the machine-readable ids. The
 * settings page, however, is read by Chinese speakers, and an English sentence
 * on every card is the defect this table fixes.
 *
 * Coverage is therefore total and explicit. Every provider id in
 * providers-registry.json has exactly one line here, and the ids are written
 * verbatim, case-sensitive, in ordinal-sorted order so a diff against the
 * registry is reviewable at a glance. Adding a vendor to the registry without
 * a line here is a build-time error, not a runtime fallback: the lookup is
 * typed and exhaustive over the registry ids, and a silent fallback to the
 * English notes is exactly the bug being fixed - it would render as a missing
 * translation instead of a missing entry, which is far harder to notice and to
 * report.
 *
 * Style: one short plain-technical sentence per vendor, no marketing language,
 * no trailing full stop. Protocol quirks name the concrete field, header or tag
 * rather than describing them vaguely. A few lines run past forty characters
 * because the concrete identifier itself - a path, a query parameter, a
 * required env var - is the useful part of the note.
 */
export const PROVIDER_NOTES_ZH: Readonly<Record<string, string>> = Object.freeze({
  "agnes": "推理内容以 think 标签返回",
  "alibaba_cloud": "DashScope 国际版兼容模式端点，base URL 与 FCC 一致",
  "anthropic": "Anthropic Messages 原生透传，标记 native_messages_passthrough",
  "azure_openai": "无默认端点，必须配置 AZURE_OPENAI_BASE_URL 与部署名",
  "baidu": "百度千帆 v2 的 OpenAI 兼容端点",
  "bazaarlink": "多厂商网关，带 auto:free slug，归为 free-tier",
  "bedrock": "Bedrock Mantle 兼容端点，密钥与模型按区域区分",
  "byteplus": "新账号赠送免费额度，含 Seed 2.0 与 Kimi K2 Thinking",
  "cerebras": "max_tokens 实际按 max_completion_tokens 发送",
  "cheaperinference": "列表只保留支持流式输出的文本模型",
  "chutes": "FCC 只列出同时支持工具调用的文本进文本出模型",
  "cline_pass": "ClinePass 订阅密钥，模型见 /ai/cline/recommended-models",
  "cloudflare": "账号级 URL，需把 {account_id} 换成实际值，含免费额度",
  "cohere": "兼容层在 /compatibility/v1，请求体会剥掉部分字段",
  "custom": "不在名录里的 OpenAI 兼容网关，端点、密钥与模型 id 都由用户填",
  "deepinfra": "按自有 /models/list 解析，取 model_name 与 reported_type",
  "deepseek": "该端点会回报缓存命中的用量",
  "experiential": "Experiential Labs 的网关",
  "featherless": "只取 tool_use 且在当前套餐内的行，分页按页码递增",
  "fireworks": "不含 embedding 模型，模型 id 是账号内的路径",
  "gemini": "Google AI Studio 密钥，走 /v1beta/openai/ 兼容层",
  "github_copilot": "GitHub 账号登录，能用哪些模型取决于订阅档位",
  "glm": "Z.ai 的 Anthropic 兼容线路，与 zai 共用 ZAI_API_KEY",
  "glm-cn": "智谱开放平台国内版编程端点，与 z.ai 国际版是两套记录",
  "groq": "OpenAI 兼容端点，同一列表里的音频 id 已剔除",
  "huggingface": "Inference Providers 路由器，上下文长度取实时共识值",
  "hyperbolic": "OpenAI 兼容 chat completions，密钥地址见 9router",
  "kilo": "Kilo 网关的免费池，与插件自身的 Kilo 通道同一主机",
  "kimchi": "9router 归为 free-tier，支持 oauth 与 apikey",
  "kimi": "Moonshot 平台密钥，该线路拒绝调用方传入 extra_body",
  "kimi_code": "Kimi Code 订阅，模型 id 取自 9router 的 kimi 注册表",
  "lightning": "Lightning AI 的 Model APIs 网关",
  "llamacpp": "本地服务器，模型列表取决于用户已加载的模型",
  "llm7": "default/fast/pro 别名被固定，只留流式工具模型",
  "lmstudio": "本地服务器，模型列表取决于用户已加载的模型",
  "minimax": "推理内容从正文流中单独拆出，语音与图像 id 已剔除",
  "minimax-cn": "国内端点，走 Anthropic Messages，含 anthropic-beta 头",
  "mistral": "La Plateforme 密钥，不含 embedding 模型",
  "mistral_codestral": "Codestral 的 IDE 端点，与 La Plateforme 密钥是两套",
  "morph": "面向编程代理的快速 apply/edit 模型",
  "nararoute": "多厂商网关，列表中推理能力以布尔值给出",
  "nebius": "不含 embedding 模型，列表必须标出模态 text->text",
  "novita": "README 示例里的模型 id",
  "nvidia_nim": "NVIDIA 开发者计划成员免费用于原型测试，FCC 默认走这条",
  "ollama": "本地服务器，FCC 会把配置的根地址归一到 /v1",
  "ollama_cloud": "免费额度轻量，一次一个云模型，tag 是 Ollama 名",
  "open_router": "免费额度含 27 个以上免费模型，日请求约 200 次",
  "openai": "浏览器登录 ChatGPT 订阅，走 codex 的 responses 线路",
  "openai_api": "平台密钥走 Responses API，非对话类 id 已剔除",
  "opencode": "免密钥免费池，同一 /zen/v1 主机，但各模型线路不同",
  "opencode_go": "OpenCode Go 订阅，每月 5 美元",
  "opencode_zen": "按量付费密钥走快速线路，含免费模型，分 chat 与 responses",
  "opper": "Opper 网关，基于 v3/compat 端点",
  "orcarouter": "多厂商网关，附带免费 slug",
  "perplexity": "带搜索增强的 Sonar 对话模型",
  "poolside": "Poolside 平台密钥",
  "qwencloud": "QwenCloud Token Plan 端点，base URL 同 FCC",
  "qwencloud_coding": "QwenCloud Coding Plan 端点，base URL 同 FCC",
  "sambanova": "README 示例里的模型 id，9router 注册表中该厂商保持隐藏",
  "scaleway": "Scaleway Generative APIs，使用 SCW 密钥",
  "siliconflow": "模型 id 取自 9router 注册表，按 sub_type=chat 过滤",
  "tencent": "腾讯混元的 OpenAI 兼容端点",
  "together": "不含 embedding 模型，FCC 在 /models 列 context_length",
  "tokenrouter": "多厂商网关，附带免费 slug",
  "venice": "私有推理加无审查模型，不含 embedding 与图像 id",
  "vercel": "Vercel AI Gateway，模型 id 带厂商命名空间",
  "vertex": "走 ADC 免密钥，用 VERTEX_PROJECT_ID 与 VERTEX_LOCATION 拼端点",
  "vertex-partner": "Vertex MaaS 合作方模型，兼容 base 按项目与区域拼出",
  "volcengine-ark": "火山引擎国内编程端点，密钥地址由 9router 给出",
  "wafer": "Wafer pass 端点",
  "wandb": "W&B Serverless Inference，推理以 think 标签返回",
  "xai": "同一列表里的图像与视频 id 已剔除",
  "xiaomi-tokenplan": "Token Plan 订阅，密钥以 tp- 开头且按集群区分",
  "xkiro": "多厂商网关，thinking 为 capabilities.reasoning 布尔",
  "zai": "Z.ai 编程套餐端点，拒绝 extra_body，共用模型 id",
  "zai_api": "Z.ai 按量付费端点，与 z.ai 各线路共用同一批模型 id",
  "zenmux": "max_tokens 实际按 max_completion_tokens 发送",
})
