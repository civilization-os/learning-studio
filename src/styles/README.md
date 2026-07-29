# Learning Studio 样式架构

样式通过 `index.css` 统一加载，并使用 Cascade Layers 固定优先级：

1. `reset`：浏览器基础归一化。
2. `legacy`：迁移前的历史样式，只读，不再新增规则。
3. `tokens`：颜色、阴影、圆角和布局令牌，包含明暗主题。
4. `base`：元素级基础样式与可访问性状态。
5. `components`：跨页面复用的组件。
6. `pages`：页面或复杂业务区域。
7. `responsive`：跨组件的断点编排。
8. `utilities`：少量单一职责工具类。

## 新增或修改样式

- 颜色必须优先使用 `tokens.css` 中的语义变量，不在组件里判断主题。
- 不新增 `html[data-theme="dark"] .component` 形式的主题补丁。
- 可复用样式放入 `components/`，只在单页出现的样式放入 `pages/`。
- 移动端首先写在对应组件附近；只有跨页面编排才放入 `responsive.css`。
- 不使用 `!important` 解决层叠问题。需要覆盖历史样式时，把规则放进正确的后置 layer。

## 主题原则

组件只描述语义，例如：

- `--color-surface`：主要内容表面
- `--color-surface-subtle`：次级内容表面
- `--color-text`：主要文字
- `--color-text-muted`：辅助文字
- `--color-border`：常规边界
- `--color-feature`：始终保持深色的重点学习区域

浅色、深色和后续主题只需要修改令牌值，不应复制整套组件选择器。

## 迁移历史样式

每次修改旧页面时：

1. 在 `legacy.css` 中找到相关选择器。
2. 用语义令牌重写到对应的 `components/` 或 `pages/` 文件。
3. 浏览器检查浅色、深色和手机宽度。
4. 确认无回归后，再删除 `legacy.css` 中被接管的规则。

当 `legacy.css` 清空后即可移除 `legacy` layer。
