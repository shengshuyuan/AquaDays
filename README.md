# AquaDays · 一缸时光

运行在 FoloToy AI Passport 上的掌上养鱼小游戏。项目设计、资源与后续代码统一保存在这个独立目录。

## 已确认方向

- 240×320 竖屏，UP / DOWN / OK 三键交互。
- 用户可以选择现实中存在的鱼种入缸，大小鱼搭配，自由游动，追求自然的外形和游动表现。
- 简单养成：每日限制投喂，清理鱼缸。
- 当前日期与时间显示在鱼缸后景，鱼从数字前方游过。
- 参考社区项目 https://ai-passport.folotoy.cn/plays/1179/ 的产品体验，使用自己的界面和资源，不复制源码或美术。

## 当前阶段

已完成 240×320 像素页面与可操作的浏览器原型，尚未实现固件。当前以 V5 孔雀鱼与螃蟹版本为准（[实际截图](docs/design/creatures-v5/day-live.png)），V1 AI 美术稿作为历史探索保留。

设计资料见 `docs/design/`。最终鱼种名单、混养规则、成长与离线计时规则仍待确定。

首版效果稿：[`aquadays-concept-v1.png`](docs/design/aquadays-concept-v1.png)，含日常鱼缸、选鱼、限量喂食、清洁四个状态。设计说明与生成提示分别保存为 `visual-brief.md`、`image-prompt.txt`。

## 查看与操作当前版本

在本目录启动本地服务（导出资源需要 HTTP 环境）：

```sh
python3 -m http.server 8791 --bind 127.0.0.1
```

访问 `http://127.0.0.1:8791/prototype/`。上下选择、确定执行、长按确定返回；键盘对应方向键、Enter 与 Esc。页面有 1× / 2× 显示切换和模拟日期入口。刷新重置演示，不连接或修改真实设备。

```sh
node tests/game.test.cjs
```

当前截图在 `docs/design/refine-v4/`，旧版截图与动画在 `docs/design/pixel-v2/`，可移植的 RGB565 / RGB565A8 与 1bpp 字形数据在 `prototype/assets/`，字体许可在 `prototype/font-licenses/`。原型无 npm 依赖，代码仓库：https://github.com/shengshuyuan/AquaDays。

## 目录边界

本项目独立于相邻的 `ai-passport` 和 `musk-experience-simulator`，不修改它们的现有内容。后续涉及固件移植时再确定复用方式；当前不创建或覆盖任何固件工程。

昼夜光照按北京时间：07:00（含）至 18:00 为白天，其他时间为夜晚；预览光照菜单可临时对比。幼鱼下方成长条已移除，喂食成长仍保留。新增预烘焙夜景背景，当前位图合计 1517889 字节。

V5：加入孔雀鱼与缸底螃蟹，共八种伙伴可选；默认六条鱼和一只螃蟹，容量八位。螃蟹缓动横爬、停顿和吃沉底食物；孔雀鱼偏中上层，鱼游速有轻微变化。素材与截图位于 docs/design/creatures-v5。属于游戏化混养，并非真实饲养配置。
