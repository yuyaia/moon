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
- 功能：字卡库/导入/管理、表情包聊天内网格、图片、涂鸦调色盘、引用/搜索/换一句、回复速度与句数、状态、收藏/漂流瓶、头像库/昵称库、聊天壁纸、宽屏侧栏、晚安模式、加密备份、音乐。
- 音乐：**放弃网易云登录/版权接入**；改为用户自己导入 MP3 等音频直链 + 本机音频上传；纯静态；不做版权绕过。
- 音乐数据独立 IndexedDB `tracks` store；本地音频放 `media`，删除曲目时清理；备份包含 tracks。
- 完整版是主入口方向；根单文件保留给内置浏览器兼容。

## 待办 / 未定

- 与ta 项目（`/root/projects/与ta`）的完整云端运行：静态页已备份到 `/yuta/`，但它依赖 `/api/netease/`；纯 GitHub Pages 不完整。其远端 `yuyaia/mock-chat` 当前不可访问。要完整运行需新仓库/新 key + Node 后端（Render/VPS），或另开一个 Node 部署。
- 音乐：后续可加音量/循环/排序/封面；当前只有链接 + 本地上传、列表、播放/暂停/上一首/下一首/进度。
- 互动小游戏（月亮问答/猜心情）未做。
- 网易云后端方案已放弃；不要重新引入 Cookie/扫码/第三方解锁。
- 跨对话没有自动记忆插件；新对话需要被明确指向本文件和仓库。
