# 大肥鱼书包动画

原始角色图层在 `assets/character-reference.png`，动作关键姿态在 `gesture-poses.cjs`。待机和随机动作保留同一轮廓锚点，书包开合使用独立片段。运行时读取已渲染到 `companion/src/bag/media/` 的透明视频。

渲染使用 Node.js、Sharp 和带 `libvpx-vp9` 的 FFmpeg。可以用 `HUIKAN_SHARP` 和 `HUIKAN_FFMPEG` 指定已安装的组件。

从本目录刷新待机与动作素材。

```sh
node render-clips.cjs --idle-only=../../companion/src/bag/media/idle-clean.webm
node render-clips.cjs --gestures=../../companion/src/bag/media/gestures
```
