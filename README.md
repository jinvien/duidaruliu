# 对答如流


## 简介

对答如流是一款为 Ollama 用户设计的以浏览器侧边栏为主场景，Local-only 的扩展程序。

**当前有以下能力：**

1. 在侧边栏选取本地模型发起对话
2. 对选中内容进行快速翻译
3. 自定义提示词
4. 深浅双色主题
5. 会话导入导出
6. 自定义 Ollama 服务地址和模型参数
7. 支持添加网址作为快捷入口，可以方便地在侧边栏打开

**后续计划添加能力的能力：**

1. 支持 MCP
2. 联网搜索
3. 语音朗读

---

# Fluently Respond

## Introduce

Fluently Respond is a Local-only browser extension designed for Ollama users, primarily operating in the browser sidebar.

**Current Features:**

1. Initiate conversations with local models via the sidebar
2. Quick translation of selected text
3. Customizable prompts
4. Light/Dark dual-color themes
5. Session import/export
6. Customizable Ollama service address and model parameters
7. Support for adding URLs as shortcuts (quick access to websites via the sidebar)

**Planned Features:**

1. MCP support
2. Web search integration
3. Voice reading (text-to-speech)


---

## 闲言碎语

自掌握编程技能以来，一路经历 Pascal、Delphi、C#、.Net，直至毕业选择了前端作为主业。彼时我连 jQuery 都不太熟悉，.Net 倒是写得流利。但遵从内心，认为前端可以直观绘制出直面用户的交互界面，隐约觉得这才是我真正所热爱的事物。

不论学生时代还是工作之后，其实陆续独立写过各类应用，用 vb+asp 写院系网站、用 .Net 写的 CMS 建站程序、用小程序写诗词游戏、在公司平台写图书分享应用、给带屏音箱写技能、基于 NBS 的即时聊天应用、记录个人碎碎念的留言板、班车实时位置互助页、Chrome 背景扩展、RIL应用...

到后来工作愈发繁忙，空闲愈少，便将内心的创造力与工作需要相结合，于是给自己造工具少了，技术项目逐渐增多，在低代码和 LLM Agent 领域做了一些提效的工作，也落地几篇专利，但属于工作产出便不展开。

但内心始终想要做一些更有趣有价值的事情，直到今年初 DeepSeek R1 引燃了整个技术与社会的讨论，也再次点燃我心中的火苗，我亦想入局于浪潮之中，做一些或许微小但有趣的事情。

在了解 R1 系列的时候，我发现本地模型生态已经相对成熟，可以方便地在本地运行各种尺寸的开源模型，尤以 Ollama 最为方便，市面上也有了很多成熟的客户端，但以独立客户端居多。而我日常工作与阅读都基本在浏览器端处理，同时 Web 也是信息量最丰富的场景，于是萌生开发基于 Chrome 扩展的对话程序的想法。

没有提前做太多的“市场调研”，项目启动前只知有“Page Assist”这一扩展程序珠玉在前，功能已经较为完善，我也有体验过。但发现在使用习惯上还是不够符合我心，于是想着提交 pr 不如自己动手写一个，毕竟“绝知此事须躬行”，后续也可基于这一形态做更多探索性的工作。例如最新的 Web 技术选型与实践、 Agent 编排、MCP、RAG... 不一而足。

奈何闲暇实在是不够多，在若干个深夜与周末写了许久，踩了些坑也才勉强达到可用状态。

之前写的各种应用，总觉得代码写的不够漂亮，“丑媳妇怕见公婆”，就没选择开源，而是自娱自乐。但考虑到一些因素，我决定以开源的方式逐渐完善这个项目：

1. 因为是主打隐私特性，为了让使用者更放心，所以源码可见是有必要的
2. 我需要一个 Git 管理端
3. 希望可以和社区有更多交流

行远自迩,便从此处开始。

