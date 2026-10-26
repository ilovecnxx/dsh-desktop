# DSH Desktop 1.4.8：拖拽遮罩残留修复

2026-10-26。只改桌面端，官方 `dsh` 核心未修改。

## 现象

拖入图片后整个界面变暗/发糊（半透明遮罩残留），需要再拖一次或重启界面才恢复。

## 根因

拖拽提示层由 preload 注入。旧逻辑：

```js
window.addEventListener('drop', (event) => {
  if (!hasFiles(event)) return   // 图片 drop 时 types 可能已不含 Files
  ...
  hideDropOverlay()
}, true)
```

浏览器/桌面拖拽图片时，`drop` 事件的 `dataTransfer.types` 不一定仍包含 `Files`
（可能只剩 `text/uri-list` 等），导致提前 return，`hideDropOverlay()` 未执行，
遮罩一直盖在页面上（`rgba(10,11,14,0.72)`），视觉上就是“模糊/发暗”。

## 修复

1. `drop` 事件**无条件先** `dragDepth=0; hideDropOverlay()`，再判断是否文件；
2. 新增 `dragend`、窗口 `blur`、`Escape` 键立即收起遮罩；
3. `dragenter/dragover/dragleave` 时安排 1.5 秒兜底自动收起；
4. 路径插入/文件夹打开完成后再次确保收起。

## 验证

- `npm test`：28/28 通过。
- 逻辑审查：图片 drop（types 无 Files）也会先收起遮罩；拖拽序列中断最多 1.5 秒自动恢复。
- 已安装 1.4.8 并重启客户端界面，服务不受影响。
