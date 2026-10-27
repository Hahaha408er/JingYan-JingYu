<p align="center"><img width="620" alt="她一边嘴硬，一边甩张梗图过来" src="https://github.com/user-attachments/assets/4919f3e5-5ebe-4c0f-a934-3ae4269ac34c"></p>

# 鲸言鲸语 · JingYan JingYu

把 DeepSeek 装进 QQ —— 会记事、会发表情包、会自己写日记的 AI 伴侣。

基于 [NapCat](https://github.com/NapNeko/NapCatQQ) + OneBot v11，跑在你自己的服务器上，数据全在本地。

> 本项目是开源二次开发，仅供技术学习交流。请使用 QQ 小号运行，因腾讯风控导致的封号概不负责。

## 她记得你

不是"把聊天记录塞进上下文"那种假记忆，而是四层：

| 层级 | 内容 | 效果 |
|---|---|---|
| 账本 | 事实、印象、待续，带时间戳 | "你上次说五点半去健身，去了吗" |
| 日摘要 | 每天把当天对话压成 3~5 条 | 隔一周还能提"那天你说要删库" |
| 月度画像 | 每月生成一段"那阵子的印象" | "熬夜加功能、骑车买东西、发图停不下来了一个月" |
| 时间感 | 现在几点、周几、距上次说话多久 | 深夜不回"早上好" |

## 她有"人味"

- **接话**：你只回"好好好""哈哈哈""？？？"，她知道那是口头反应，不会追着问"你话说一半"
- **表情包**：内置 30 张入门表情（`笑 / 无语 / 骂 / 委屈 / 得意 / 撒娇`），她自己按心情挑；想加自己的图，丢进 `data/stickers` 再在 `index.json` 写一行就行
- **图库**：你发的图她能收进自己的库，每张配一句理由，之后按理由翻出来给你看
- **日记**：每天在 21:00~次日 02:00 之间随机挑时间，自己写一篇
- **状态**：有精力、有耐心，深夜会蔫、被骂会烦
- **生活感**：一天里她也有自己的事（写日记、翻教程、B 站乱逛），但不会主动汇报
- **主动找你**：45~110 分钟随机看一眼，安静够了才可能开口，每天有上限

## 她会用手机

给她一台安卓机（Termux + adb 无线调试），她能：

- 看你的屏幕（截图，压到 720p 省流量）
- 按屏幕上**文字**点（`点字 QQ`，不用瞎估坐标）
- 开应用、返回、滑动、看通知、报电量
- 把截图发给你

她不能打字、不能改设置、不能打电话（故意没做）。

## 其他

- **听歌**：你把歌分享给她，或者用 Last.fm 实时读你正在听什么
- **语音**：`edge-tts` 合成，她可以发语音条（也能只在深夜安静地发）
- **识图**：你发的图她能看懂（走 NapCat 的 get_image）
- **群聊**：多群独立配置、群管理员、按场合权限（群里默认不准发图库、绝对不准发手机截图）

## 快速开始

**要求**：Linux 服务器（2 核 2G 够）、Node ≥ 20、Docker

```bash
# 1. 先装 NapCat（扫码登录用）
docker run -d --name napcat --restart=always \
  -p 127.0.0.1:3000:3000 -p 127.0.0.1:3001:3001 -p 127.0.0.1:6099:6099 \
  -v /root/napcat/config:/app/napcat/config \
  -v /root/napcat/qq:/app/.config/QQ \
  mlikiowa/napcat-docker:latest
docker logs -f napcat          # 等二维码出来，扫码登录

# 2. 再装她
unzip jingyanjingyu-v1.0.0-basic.zip
cd jingyanjingyu-v1.0.0-basic
bash install.sh                # 装依赖 + 生成配置
nano config.json               # 填 apiKey、ownerIds、ownerName
nohup npm start >> bot.log 2>&1 &
```

**NapCat 里必须做的两件事**（不做会一直报 `ECONNRESET`）：

1. 打开 WebUI 加两个服务：**HTTP 服务 3000** + **WebSocket 服务 3001**
   （`ssh -L 6099:127.0.0.1:6099 root@你的IP` 之后访问 `http://127.0.0.1:6099/webui`）
2. 两个服务的 **Host 都填 `0.0.0.0`**，Token 和 `config.json` 里的 `onebot.accessToken` 保持一致

> 顺序也可以反过来：先装她、跑通 `bash install.sh`，再回头装 NapCat。只是这样识图要手动补一步——容器起来后执行 `node tools/detect-napcat.js --apply`，它会自动把路径写进 `config.json`（先装 NapCat 的话，`install.sh` 会替你做完这一步）。

详细图文（含七个踩坑 FAQ、升级流程）见**下载包内**的 `README.md`（买家手册）。

## 两个版本

| | 基础版（免费） | 进阶版 |
|---|---|---|
| 记忆（账本/日摘要/画像） | ✅ | ✅ |
| 表情包 / 图库 | ✅ | ✅ |
| 状态 / 生活感 | ✅ | ✅ |
| 主动找你 | 2 条/天，90~180 分钟 | 6 条/天，45~110 分钟 |
| 日记 / 语音 / 听歌 / 手机 | ❌ | ✅ |

基础版**物理上不含**进阶模块的源码文件，不是开关隐藏。

## 数据在哪

全在 `data/`，纯文本 + JSON，你可以随时打开看：

```
data/people.json     账本（事实/印象/待续/话题）
data/turns.jsonl     全部对话
data/days/*.json     日摘要
data/diary/*.md      她自己写的日记
data/gallery/        她攒的图
data/stickers/       表情包
```

## 免责声明

- 本项目为开源二次开发，仅供技术学习交流，与 DeepSeek、腾讯、NapCat 均无隶属关系
- **请使用 QQ 小号运行**。自动化操作 QQ 属于非官方行为，存在风控与封号风险，因封号导致的任何损失概不负责
- 模型调用产生费用由使用者自行承担
- 语音合成（edge-tts）为第三方服务，其可用性不受本项目控制
- 本项目按 MIT 协议"按现状"提供，不提供任何明示或暗示担保

## 交流群

装的过程中卡住了，或者想聊她该怎么调教，都可以进来：

**QQ 群：215046767**

进群先看一眼群公告里的三条自查——八成的问题都在里面：

1. `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/get_login_info -H 'authorization: Bearer 你的token'` 是不是返回 `200`
2. NapCat 里两个 OneBot 服务的 **Host 是不是填的 `0.0.0.0`**（填 `127.0.0.1` 会一直 ECONNRESET）
3. `tail -n 30 bot.log` 最后一行报的是什么

## License

[MIT](LICENSE) · 基于 ai-companion-kit 二次开发（https://github.com/pinganbbOvO/ai-companion-kit/tree/main），保留原作者版权声明。
