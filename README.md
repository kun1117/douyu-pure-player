# 斗鱼纯净播放器 / Douyu Pure Player

一个去除弹幕和杂项的斗鱼直播纯净播放器，只播放直播画面和声音。

基于 [flv.js](https://github.com/Bilibili/flv.js) 实现，通过后端代理获取斗鱼直播流地址，提供沉浸式的纯净观看体验。

## 特点

- **纯净无干扰** — 无弹幕、无礼物特效、无推荐列表，只有直播画面
- **暗色/浅色双主题** — 支持一键切换，偏好自动保存至本地
- **自动重连** — 直播断流时自动尝试恢复，最多重试 10 次
- **音量控制 + 全屏** — 底部控制栏集成，快捷键 `F` 切换全屏
- **主播信息卡片** — 自动显示主播头像、昵称、直播间标题、直播状态
- **广播监视器质感** — 暗光噪点纹理、毛玻璃控制栏、视频辉光边框
- **响应式设计** — 桌面和移动端均有良好适配

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 启动服务
npm start

# 3. 打开浏览器访问
#    http://localhost:3000
```

## API

| 接口 | 说明 |
|------|------|
| `GET /api/room/:roomId` | 获取直播间信息（主播名、头像、标题、状态） |
| `GET /api/live/:roomId` | 获取直播流地址（FLV） |
| `GET /api/proxy?url=...` | CORS 代理转发 FLV 流 |

### 示例

```bash
# 获取房间 6（斗鱼官方直播）的信息
curl http://localhost:3000/api/room/6

# 获取直播流地址
curl http://localhost:3000/api/live/6?rate=0
```

## 技术栈

- **前端** — HTML + CSS + flv.js
- **后端** — Node.js + Express
- **流处理** — safe-eval（执行斗鱼签名函数）+ axios

## 项目结构

```
douyu-pure-player/
├── public/
│   └── index.html      # 前端页面（样式+脚本+布局）
├── server.js            # Node.js 后端服务
├── package.json
├── package-lock.json
└── README.md
```

## 主题

- **暗色主题**（默认） — 深色微渐变 + 银盐噪点纹理，广播控制室风格
- **浅色主题** — 暖白基调 + 柔和阴影，明亮监听站风格

点击底部的 🌙/☀️ 按钮切换。

## 许可证

MIT
