# moon · project memory

> 给下一位接手的助手：先读这个文件，再读 README.md。这里只放不敏感的项目事实，不放密码、Cookie、token 或私钥内容。

## 项目

- 本地目录：`/root/projects/moon`
- 单文件：`moon.html`
- 手机兼容单文件：`moon-mobile.html`（去掉 Service Worker 注册）
- 完整静态站点：`dist/`；部署包：`moon-site.zip`
- 线上仓库：https://github.com/yuyaia/moon
- 线上兼容版：https://yuyaia.github.io/moon/
- 线上完整 PWA：https://yuyaia.github.io/moon/full/
- 与ta 静态备份：https://yuyaia.github.io/moon/yuta/（只有前端，`/api/netease` 后端未部署，网易云登录/播放不可用）
- GitHub Pages 来源：`main` / `(root)`；`.nojekyll` 已存在；不要重新加失败的 Actions 部署 workflow。

## 部署

- 仓库写入使用本机 deploy key：`/root/.ssh/moon_deploy`（仅 yuyaia/moon 有写权限；不要输出私钥）。
- 本地发布目录：`/root/projects/moon/github-deploy/`
- 发布结构：
  - 根 `index.html` / `moon-mobile.html`：单文件兼容版
  - `full/`：完整 PWA（index.html + css + js + manifest + sw + icons）
- Pages 已启用，推 `main` 后会自动重建；无需再改 Pages 设置。
- 另一把 `/root/.ssh/yuyaia_mock_chat_deploy` 对应 `yuyaia/mock-chat`，当前 SSH 访问被拒（仓库可能私有/已删除/换了 key），不要拿它推 moon。

## 构建 / 测试

```bash
cd /root/projects/moon
node tools/build-single.mjs
cd /tmp/pw
node apptest2.mjs        # 31
node importtest.mjs      # 24
node managementtest.mjs  # 19
node handfeel.mjs        # 11
node backuptest.mjs      # 29
node memrestore.mjs      # 5
node bottletest.mjs      # 18
node decortest.mjs       # 28
node stickertest.mjs     # 10
node nighttest.mjs       # 15
node musictest.mjs       # 17
node singlefile2.mjs     # 7
node singlefile3.mjs     # 14
```

## 已定方向

- 单角色 moon；纯白/冷蓝灰；房间感，不做应用大厅。
- 功能：字卡库/导入/管理、表情包聊天内网格、图片、涂鸦调色盘、引用/搜索/换一句、可调回复间隔与句数范围、状态、收藏/漂流瓶、恋恋心（头像/昵称独立页）、聊天壁纸、宽屏侧栏、晚安模式、加密备份、音乐。
- 音乐：**放弃网易云登录/版权接入**；改为用户自己导入 MP3 等音频直链 + 本机音频上传；纯静态；不做版权绕过。
- 音乐数据独立 IndexedDB `tracks` store；本地音频放 `media`，删除曲目时清理；备份包含 tracks。
- 完整版是主入口方向；根单文件保留给内置浏览器兼容。

## 视觉整理（已完成）

- 设置底部去掉“第一版骨架”，改成“moon · 一个安静的房间”。
- 壁纸暮色改冷灰蓝并改名“暮灰”；纸白去掉奶油黄。
- 收藏不再每行重复“会进瓶子”，只在顶部说明。
- 音乐页顶部收成一个“添加音乐”抽屉，分链接 / 本机文件；页面只留列表和播放器。
- 开场页环改成连续正圆，不用断弧。
- 晚安时间改成无边框“睡 23:30 · 起 07:30”细线样式。

## 闪屏 / 应用页 / 设置 / 恋恋心

- 打开是 moon 闪屏，不登录，轻触屏幕进入；不显示“轻触进入”文案。
- 应用页：时间/日期/节气文案/周条（不是大月历）、顶部小照片组件、中间两个 58px 照片圈（我 / moon）+ 圈后背景；底部固定聊天/字卡库/设置。照片全部用原生相册 file input，不走 URL。
- 聊天退出回应用页。
- 聊天顶部左侧齿轮直接打开设置；点任意头像直接进恋恋心。
- 应用页的 photo/avatar/cover 分别是 homePhoto/homeAvatar/homeCover，三张独立。
- ＋ 里的恋恋心已移除；＋ 保留聊天动作（表情包/收藏/图片/晚安/音乐/涂鸦）。

## 恋恋心（独立页，参考与ta）

- 聊天顶部左侧齿轮直接打开设置；点任意头像直接进恋恋心对应页，不再先弹文件选择。

- 从设置里剥离，聊天 ＋ → 恋恋心，单独一页。
- 我 / 角色两层，头像 / 昵称两个子栏。
- 头像可上传、选择、删除；删除当前头像会顺延到下一张或回退默认。
- 昵称可添加、选择、删除；删除当前昵称回退“我 / moon”。
- “让 moon 换一次”分“我的 / 角色的”：各自从对应头像库随机换，并切到对应预览。
- 没有做自动换头像概率；避免 moon 在用户没看时自己变。
- 聊天 ＋ 里的“换我的头像 / 换 moon 的头像”已合并成“恋恋心”；两字“设置”入口已删除；恋恋心不再借用设置页。
- 聊天顶部左侧齿轮是设置入口；＋ 里的恋恋心是独立页。



## 外观 / 回复范围

- 跟随时间默认 22:00 入夜、06:00 天亮；入夜/天亮时间可调。
- 符号跟随时间与外观共用这一套入夜/天亮时间。
- 回复间隔填最短/最长秒数（0.2–10），句数填最少/最多（1–4），不再用固定档位。

## 待办 / 未定

- 与ta 项目（`/root/projects/与ta`）的完整云端运行：静态页已备份到 `/yuta/`，但它依赖 `/api/netease/`；纯 GitHub Pages 不完整。其远端 `yuyaia/mock-chat` 当前不可访问。要完整运行需新仓库/新 key + Node 后端（Render/VPS），或另开一个 Node 部署。
- 音乐：后续可加音量/循环/排序/封面；当前只有链接 + 本地上传、列表、播放/暂停/上一首/下一首/进度。
- 互动小游戏（月亮问答/猜心情）未做。
- 网易云后端方案已放弃；不要重新引入 Cookie/扫码/第三方解锁。
- 跨对话没有自动记忆插件；新对话需要被明确指向本文件和仓库。
