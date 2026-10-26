# DSH Desktop 1.4.11：把拖拽附件交还给 dsh 原生处理

2026-10-26。只改桌面端，官方 `dsh` 核心未修改。

## 诊断证据

1.4.9 的拖拽诊断在真实拖入图片后记录了：

```json
{"overlay":false,"masks":[{"tag":"div","cls":"BInVoG_mask","role":"status",
"backdropFilter":"blur(10px)","rect":[0,0,1214,1029],
"text":"文件或图片拖动到此处即可添加图片限制：最多 20 张，每张 20MB"}],"dialogs":0}
```

即模糊层是 **dsh 前端自带的全屏拖拽提示层**，而且 dsh 本来就支持拖拽图片作为
附件（最多 20 张，每张 20MB）。此前客户端在 capture 阶段
`preventDefault + stopImmediatePropagation` 拦截 drop，使 dsh 的拖拽状态机收不到
drop、提示层一直不关闭，于是UI一直“模糊”。

## 修复

- preload 不再拦截 `dragenter/dragover/drop`（不 preventDefault、不 stopPropagation，
  也不注入自定义遮罩）；
- 文件/图片粘贴同样不再拦截，交给 dsh 原生附件处理；
- 保留「超长文本粘贴 → 保存 txt → 插入路径」功能（只处理纯文本）；
- 保留拖拽诊断，但改为**纯观察**：drop 后 800ms 记录残余的 blur 遮罩并截图，
  不改变事件行为。

## 验证

- `npm test`：28/28 通过。
- 真实拖拽图片后：dsh 原生提示层会自行收起，图片作为附件进入输入区；
  诊断仍会把残余遮罩写入 `main.log` 与 `drop-diag-latest.png`。
