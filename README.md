# GARGANTUA — Schwarzschild Black Hole Raytracer

全屏交互式黑洞光线追踪站点。整幅画面由单个 Fragment Shader 实时数值积分
Schwarzschild 度规下的零测地线得到 —— 没有黑球、没有贴图圆环、没有视频：
事件视界、光子环、多次吸积盘穿越、引力透镜、Doppler 增亮与引力红移全部来自物理积分。

A fullscreen interactive site. Every pixel is produced by numerically integrating
Schwarzschild null geodesics (Binet equation `u'' = -u + 3/2·rs·u²`, RK4, per pixel)
in a fragment shader. Nothing is faked.

## 启动 / Run

无需构建。任意静态服务器即可（ES Modules 不能从 `file://` 加载）：

```bash
cd gargantua
python3 -m http.server 8613
# 打开 http://localhost:8613/
```

或 `npx serve .`、`php -S localhost:8613` 等。

## 物理 / Physics

- 单位制：史瓦西半径 `rs = 1`，`G = c = 1`，`M = 1/2`。
- 每条光线在其轨道平面内积分 Binet 方程（RK4，φ 步进），光子球 `r = 1.5 rs`、
  临界撞击参数 `b_c = 3√3/2 ≈ 2.598 rs` 由方程自然涌现（调试视图 5 可见）。
- 薄盘穿越解析求解：平面交点相位 `φ_k = φ₀ + kπ` 闭式已知，步内 Hermite 插值
  取得穿越半径 —— 上下盘像与高阶光子环像来自多次穿越的前向透射率累积。
- 盘面：Shakura–Sunyaev 型温度剖面（内缘零扭矩锥削）、开普勒差速旋转
  `Ω = √(M/r³)`、流动坐标系 fbm 湍流。
- 相对论光学：`g = δ·√(1-rs/r_em)/√(1-rs/r_obs)`，`δ = 1/(γ(1-β·n̂))`，
  色温按 `g` 移动（黑体三通道 Planck 采样），强度按 `g^(3·beaming)` 增亮。
- 背景：三层程序化恒星格点（方向哈希，黑体色温）+ fbm 银河带（尘埃带、暖核）。

## 渲染管线 / Pipeline

geodesic pass (HDR half-float, 内部分辨率按质量档缩放) → 阈值提亮 → 4 级高斯
金字塔 Bloom → 合成 + 径向色散 + ACES + 暗角 + 胶片颗粒 + 抖动 → sRGB 输出。
调试视图 3–9 直通跳过调色。

## 操控 / Controls

| 键 | 功能 |
|---|---|
| 拖拽 / 滚轮 | OrbitControls 环绕 / 推拉 |
| `Space` | 电影镜头循环（120 s 无缝回环）开/关 |
| `Shift+1…4` | 视角预设：EQUATORIAL / ORBITAL / POLAR / PHOTON RING |
| `0…9` | 调试视图（0 = 成片；1 透镜背景 2 盘面隔离 3 积分步数 4 平面穿越数 5 撞击参数 6 g 因子 7 盘温度 8 湍流场 9 HDR 亮度）|
| `H` | HUD 显隐 |
| `M` | 氛围音频（本地合成 48 s 无缝循环）|
| `S` | 保存 PNG 截图 |
| `Q` | 质量档循环 Standard → High → Cinematic |
| `P` | 冻结/恢复时间 |
| `F` | 全屏 |
| `R`,`R` | 双击重置全部状态 |

HUD 左下抽屉含全部 **21 项参数**（吸积盘 8 / 相对论 2 / 积分器 2 / 深空 2 /
光学 1 / 调色 6），双击参数名恢复单项默认。全部状态持久化到 `localStorage`。

## 质量档 / Quality

| 档 | 内部分辨率 | DPR 上限 | 默认步数 |
|---|---|---|---|
| Standard | 62 % | 1.5 | 176 |
| High | 85 % | 2.0 | 288 |
| Cinematic | 100 % | 2.0 | 420 |

移动端（粗指针）默认 Standard；内部像素预算上限 2600×1500 防止超大 Retina 爆显存。

## URL 自动化接口 / Automation

```
http://localhost:8613/?w=1920&h=1080&t=12.5&preset=1&q=cinematic&hud=0&shot=1
```

`w,h` 固定绘制缓冲尺寸 · `t` 冻结时间（确定性输出）· `preset` 1–4 · `q` 质量档 ·
`debug` 0–9 · `cine`/`music`/`hud` 0|1 · `shot=1` 渲染后自动下载 PNG，并设置
`window.__GARGANTUA_SHOT_DONE = true`、`window.__GARGANTUA_LAST_SHOT`(dataURL)，
控制台输出 `[GARGANTUA] SHOT_READY` 供 puppeteer/CDP 等待。

运行时 API：`window.GARGANTUA.{set(k,v), preset(n), quality(q), debug(n), cine(b), freeze(t), thaw(), capture(w,h), benchmark(), benchmarkStatus(), stats()}`。

## 容错 / Resilience

- WebGL2 不可用 → 样式化错误卡片（含恢复指引）；着色器编译失败 → 显示驱动日志。
- `webglcontextlost/restored` → 自动暂停并重建渲染目标恢复。
- 无 `EXT_color_buffer_float` 的设备自动降级 LDR 管线继续运行。
- `localStorage` 不可用（隐私模式）时无状态运行。

## 文件 / Files

```
index.html            入口 + importmap + 引导/错误覆盖层
css/style.css         HUD 仪表样式（设计契约见 DESIGN.md）
js/main.js            渲染管线·相机·热键·截图·恢复
js/shaders.js         GLSL：测地线积分器 + Bloom + 调色
js/config.js          21 参数 schema·质量档·预设
js/hud.js  js/state.js  js/audio.js
vendor/three.module.js  vendor/OrbitControls.js   (three r171, 本地)
assets/ambient.wav    合成氛围音（tools/make_audio.py 生成）
```

## 测试结果 / Test results

环境：macOS · Apple M1 Pro · Chrome 151 headless（ANGLE Metal 真实 GPU）· three r171。

### 隐藏 shader 基准

`?bench=1&int=rk4|rkck&tol=loose|balanced|strict&noiseMask=0..7` 会冻结画面，
预热 12 帧，并收集 30 个有效的 geodesic GPU timer 样本。报告写入
`window.__GARGANTUA_BENCH_REPORT`，完成时设置
`window.__GARGANTUA_BENCH_DONE = true`，同时 POST 到 probe sink。可用
`orbits=2|4` 覆盖基准轨道预算（默认 4）。若
`EXT_disjoint_timer_query_webgl2` 缺失，报告只包含明确标注、不可用于默认晋级的
blocking wall-time。

### 主页本机自动调优

HUD 右下角的 **Bench** 会在当前设备上冻结当前画面并依次标定质量档、噪声
mask、轨道预算与 RKCK 容差。它优先保留可持续的最高质量档，然后仅在 GPU timer
收集到完整样本、画面/终止分类未退化且候选满足速度阈值时应用获胜配置。运行状态仅在
按钮中显示；结束后渲染会恢复。

获胜配置只保存到本浏览器的 `localStorage`，并绑定 WebGL renderer/HDR 信息；更换
GPU、浏览器渲染器或能力后会自动回退到 shipped 默认值。没有
`EXT_disjoint_timer_query_webgl2` 时 Bench 只生成建议，不会更改或保存设置。可从
控制台调用 `window.GARGANTUA.benchmark()`，并通过
`window.__GARGANTUA_AUTO_BENCH_REPORT` 查看完整决策报告；双击 **Reset** 可清除
保存的调优结果。

- 静态资源 11/11 全部 200（含 vendor 与音频）；ES Module 语法检查 8/8 通过。
- 自动化验收（`?probe=1` 页内自检探针 + `tools/test_server.py` 回收报告与整帧 PNG）：
  - 桌面 1280×720：**19/19 PASS** —— 非黑屏（非黑像素 54–70%）、高光与暖色盘面、
    HUD 21 滑杆 / 4 预设 / 3 质量档 / 抽屉开合 / 遥测活跃、快捷键 0–9 · ⇧1–4 ·
    Space · H · Q、API `set/freeze` 确定性帧、盘面隔离与透镜背景调试视图。
  - 窄屏 390×844（Standard 档）：全部通过。
- 控制台：全程 **0 JS 错误、0 未捕获 rejection**。
- 性能（M1 Pro）：High 1088×538 ≈ 121 FPS；Cinematic 1280×633 ≈ 70–88 FPS。
- 视觉验收：`docs/hero.png`（成片）、`docs/polar.png`（极向俯视，湍流螺旋无接缝）、
  `docs/photon-ring.png`（光子环特写）、`docs/debug-gfactor.png`（Doppler×引力 g 因子场，
  红移/蓝移左右分布正确）。

说明：极向俯视场景下探针的亮度阈值检查按赤道参数设定，该视角横向 Doppler 物理性偏暗
属预期，非缺陷。`js/probe.js` 仅在 `?probe=1` 时动态加载，正常访问零开销。
