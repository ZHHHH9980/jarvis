# Jarvis V1 设计文档

日期：2026-02-23
状态：已确认

## 定位

Telegram Bot 驱动的服务器管理 + AI 编程助手。通过手机 24h 编程，数据可感知、可迁移、可复活。

## 架构

```
手机 Telegram ←→ Telegram Bot API
                      ↕
              Jarvis (Express 后端)
              ├── telegram-bot.js      消息收发 + 快捷命令
              ├── claude-runner.js     调用 claude --print，流式输出
              ├── inventory.js         数据资产扫描 + 注册 API
              ├── migrator.js          打包 + rsync + 恢复
              ├── notifier.js          主动通知
              ├── db.js                SQLite（项目清单、manifest）
              └── revive.sh            一键复活脚本
                      ↕
              Claude Code CLI (服务器上)
                      ↕
              项目代码 (git repos)
```

## 三个 Repo 的关系

| Repo | 职责 | 关系 |
|------|------|------|
| jarvis | Telegram Bot + 数据感知 + 迁移 + 通知 | 贾维斯本体 |
| claude-code-manager | Web 管理面板 + pty/tmux | 可选，贾维斯可调其 API |
| claude-workflow | 开发工作流插件 | 每个项目装，注册到贾维斯 |

## Telegram Bot 交互

主菜单：
- `/projects` — 项目列表，选项目后进入对话模式
- 直接发文字 — 对当前项目发需求，Claude Code 执行

隐藏命令（不放菜单，直接输入）：
- `/status` — 服务器 + 服务状态
- `/inventory` — 数据资产清单
- `/migrate` — 启动迁移流程
- `/backup` — 手动触发备份

对话流程：
```
/projects → 选项目 → 发需求 → Claude Code 执行 → 返回结果
```

主动通知：
- Claude Code 任务完成/失败
- Ralph 循环结束
- 服务器资源告警（CPU/内存/磁盘）
- pm2 进程崩溃重启

## 数据感知

双模式：
- Pull：`inventory.js` 定时扫描服务器（git repos、*.db、.env*、pm2 list、crontab）
- Push：`claude-workflow` 的 SessionStart hook 调 `POST /api/register` 注册项目

manifest 存 SQLite，每条记录：path、type（repo/database/config/service/cron）、source（scan/register）、last_seen、meta（JSON）

## 迁移

`/migrate` 触发：
1. 全量扫描更新 manifest
2. 展示清单确认
3. 打包 db + .env + manifest.json → tar.gz（repos 不打包，记录 clone 地址）
4. rsync 到新服务器
5. 新服务器跑恢复脚本

## 一键复活

服务器崩溃后：
```bash
ssh root@新服务器
curl -sL https://raw.githubusercontent.com/ZHHHH9980/jarvis/main/revive.sh | bash
```

revive.sh 流程：
1. 装基础依赖（git, nodejs, npm, tmux）
2. clone jarvis repo
3. 交互式输入密钥（Anthropic API Key, API Base URL, TG Bot Token, TG Chat ID, Notion Token）
4. 生成 .env
5. npm install + pm2 start
6. 从 manifest 恢复项目（clone repos）
7. 安装 claude-workflow

## 技术栈

- Runtime: Node.js
- Bot: node-telegram-bot-api
- DB: better-sqlite3
- CLI: child_process.spawn (claude --print)
- 通知: Telegram sendMessage API
- 部署: pm2

## V1 范围

做：
- Telegram Bot 对话 + /projects 菜单
- claude-runner 调用 Claude Code CLI
- inventory 扫描 + 注册 API
- 主动通知（任务完成、进程崩溃）
- revive.sh 一键复活

不做（后续迭代）：
- 多贾维斯实例
- 语音输入
- Web UI
- 完整迁移自动化（V1 先做打包，手动 rsync）
