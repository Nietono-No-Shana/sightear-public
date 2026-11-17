# SightEar

面向作曲者的单用户视唱练耳 / 视唱训练器。纯 Web、本地优先、无后端：所有数据保存在浏览器 IndexedDB，课程与题目由纯函数生成，同一个 seed 必然得到同一道题。

## 功能

- **题型**：音程辨认与比较、和弦辨认（含转位）、扩展和弦与和声进行、节奏视读与听写、旋律视唱 / 模唱 / 听写、音阶与调式辨认。
- **自适应**：按预测成功率 `p` 选题，能力值由历史 Attempt 重放得出，不是黑箱分数。
- **复习**：按自然日排程的间隔复习，`dueAt` 以天为单位。
- **音色**：钢琴使用 Salamander Grand Piano 采样（可回退到内置振荡器），另有弦乐 / 合成器 / 管风琴。
- **可复现**：`(seed, attempts[])` 完全决定一次会话；引擎不依赖时间、随机数或浏览器 API。

## 快速开始

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # vitest
npm run typecheck
npm run build
```

需要 Node 20+。

## 内容是可插拔的

仓库只自带 4 个**样例内容包**（`content/packs/*-sample.json`），课程由 `content/catalog.json` 声明：

```jsonc
{
  "schemaVersion": 1,
  "courses": [{
    "id": "sightear:sample-interval",
    "title": "音程与和弦辨认",
    "group": "comprehensive",
    "modules": [{
      "id": "sightear:sample-interval:m1",
      "title": "音程",
      "lessons": [{
        "id": "sightear:sample-interval:m1:l1",
        "title": "下行三度辨认",
        "content": { "packId": "sample.authoring-v3", "lessonId": "sample.interval" }
      }]
    }]
  }]
}
```

- 有 `content` 的课次若能在对应 pack 里找到 lesson，就能进入训练；找不到时构建期直接报错（`unknown pack` / `unknown lesson`），不会静默变成空课。
- 没有 `content` 的课次显示为「尚未编写」，可以留作课程大纲。
- 想用自己的课程库：把 pack 放进 `content/packs/`，在 `content/catalog.json` 里加课程即可，无需改代码。

`content/catalog.json` 存在时优先使用；没有该文件时退回内置课程表，所以同一个代码库既能跑公开样例，也能跑本地的完整课程库。

## 结构

```
src/engine/      纯函数：题目生成、判分、能力、调度、理论（禁止浏览器 API）
src/adapters/    音频、谱面、麦克风、持久化
src/store/       课程库、内容加载、Attempt 提交
src/ui/          页面与交互
content/         catalog.json + packs/
tests/           vitest（engine 覆盖为主）
```

详见 `docs/ARCHITECTURE.md`。

## 许可

代码 MIT，见 `LICENSE`。第三方资源：

- 钢琴采样：Salamander Grand Piano V3，Alexander Holm，CC BY 3.0（详见 `public/audio/piano/LICENSE.txt`）
- 乐谱字体：Bravura，SIL Open Font License 1.1（`public/fonts/Bravura-OFL.txt`）

仓库不含任何第三方商业教程的课程数据；样例内容均为本项目原创。
