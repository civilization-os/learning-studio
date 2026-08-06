import { useMemo, useState } from "react";
import type {
  InteractiveDemo,
  InteractiveSliderParam,
} from "../../studyAgent";
import { MathText } from "../shared/MathText";

/* ---------------- 安全的函数表达式求值器（不用 eval） ---------------- */

type Token =
  | { kind: "num"; value: number }
  | { kind: "ident"; name: string }
  | { kind: "op"; value: string }
  | { kind: "lparen" }
  | { kind: "rparen" }
  | { kind: "comma" };

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    const ch = source[cursor];
    if (/\s/.test(ch)) {
      cursor += 1;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      const match = source.slice(cursor).match(/^[0-9]*\.?[0-9]+([eE][+-]?[0-9]+)?/);
      if (!match) throw new Error(`无法解析数字：${ch}`);
      tokens.push({ kind: "num", value: Number(match[0]) });
      cursor += match[0].length;
      continue;
    }
    if (/[a-zA-Z_αβγθπ]/.test(ch)) {
      const match = source.slice(cursor).match(/^[a-zA-Z_αβγθπ][a-zA-Z0-9_αβγθπ]*/);
      if (!match) throw new Error(`无法解析标识符：${ch}`);
      tokens.push({ kind: "ident", name: match[0] });
      cursor += match[0].length;
      continue;
    }
    if ("+-*/^".includes(ch)) {
      tokens.push({ kind: "op", value: ch });
      cursor += 1;
      continue;
    }
    if (ch === "(") {
      tokens.push({ kind: "lparen" });
      cursor += 1;
      continue;
    }
    if (ch === ")") {
      tokens.push({ kind: "rparen" });
      cursor += 1;
      continue;
    }
    if (ch === ",") {
      tokens.push({ kind: "comma" });
      cursor += 1;
      continue;
    }
    throw new Error(`无法识别的字符：${ch}`);
  }
  return tokens;
}

const MATH_FUNCTIONS: Record<string, (...args: number[]) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  exp: Math.exp,
  ln: Math.log,
  log: Math.log10,
  log2: Math.log2,
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  abs: Math.abs,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  sign: Math.sign,
  min: Math.min,
  max: Math.max,
};

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  e: Math.E,
};

class Parser {
  private index = 0;
  constructor(private tokens: Token[], private variables: Record<string, number>) {}

  private peek(): Token | undefined {
    return this.tokens[this.index];
  }

  private next(): Token | undefined {
    return this.tokens[this.index++];
  }

  parse(): number {
    const value = this.parseAdditive();
    if (this.index < this.tokens.length) {
      throw new Error("表达式末尾有多余内容");
    }
    return value;
  }

  private parseAdditive(): number {
    let value = this.parseMultiplicative();
    while (true) {
      const token = this.peek();
      if (token?.kind === "op" && (token.value === "+" || token.value === "-")) {
        this.next();
        const right = this.parseMultiplicative();
        value = token.value === "+" ? value + right : value - right;
      } else {
        return value;
      }
    }
  }

  private parseMultiplicative(): number {
    let value = this.parseUnary();
    while (true) {
      const token = this.peek();
      if (token?.kind === "op" && (token.value === "*" || token.value === "/")) {
        this.next();
        const right = this.parseUnary();
        if (token.value === "/" && right === 0) {
          value = Number.NaN;
        } else {
          value = token.value === "*" ? value * right : value / right;
        }
      } else {
        return value;
      }
    }
  }

  private parseUnary(): number {
    const token = this.peek();
    if (token?.kind === "op" && (token.value === "+" || token.value === "-")) {
      this.next();
      const value = this.parseUnary();
      return token.value === "-" ? -value : value;
    }
    return this.parsePower();
  }

  private parsePower(): number {
    const base = this.parsePrimary();
    const token = this.peek();
    if (token?.kind === "op" && token.value === "^") {
      this.next();
      const exponent = this.parseUnary();
      return Math.pow(base, exponent);
    }
    return base;
  }

  private parsePrimary(): number {
    const token = this.next();
    if (!token) throw new Error("表达式意外结束");
    if (token.kind === "num") return token.value;
    if (token.kind === "ident") {
      if (this.peek()?.kind === "lparen") {
        const fn = MATH_FUNCTIONS[token.name];
        if (!fn) throw new Error(`不支持的函数：${token.name}`);
        this.next(); // 吃掉 (
        const args: number[] = [];
        if (this.peek()?.kind !== "rparen") {
          args.push(this.parseAdditive());
          while (this.peek()?.kind === "comma") {
            this.next();
            args.push(this.parseAdditive());
          }
        }
        if (this.peek()?.kind !== "rparen") throw new Error("函数缺少右括号");
        this.next();
        try {
          return fn(...args);
        } catch {
          return Number.NaN;
        }
      }
      if (token.name in this.variables) return this.variables[token.name];
      if (token.name in CONSTANTS) return CONSTANTS[token.name];
      throw new Error(`未知变量：${token.name}`);
    }
    if (token.kind === "lparen") {
      const value = this.parseAdditive();
      if (this.peek()?.kind !== "rparen") throw new Error("缺少右括号");
      this.next();
      return value;
    }
    throw new Error("表达式语法错误");
  }
}

/** 安全求值：只支持数学函数与变量，不执行任意代码 */
export function evaluateExpression(
  expression: string,
  variables: Record<string, number>,
): number {
  const tokens = tokenize(expression);
  return new Parser(tokens, { ...variables }).parse();
}

/* ---------------- SVG 函数绘图（slider） ---------------- */

type SliderDemo = Extract<InteractiveDemo, { type: "slider" }>;

function FunctionPlot({
  demo,
  params,
}: {
  demo: SliderDemo;
  params: Record<string, number>;
}) {
  const { path, domainY, invalid } = useMemo(() => {
    const width = 560;
    const height = 320;
    const padding = 28;
    const xMin = demo.xMin;
    const xMax = demo.xMax;
    const samples = 320;
    const yAutoMin = demo.yMin;
    const yAutoMax = demo.yMax;

    const points: Array<{ x: number; y: number }> = [];
    let hasNaN = false;
    for (let i = 0; i <= samples; i += 1) {
      const x = xMin + ((xMax - xMin) * i) / samples;
      let y: number;
      try {
        y = evaluateExpression(demo.expression, { ...params, x });
      } catch {
        hasNaN = true;
        continue;
      }
      if (!Number.isFinite(y)) {
        hasNaN = true;
        continue;
      }
      points.push({ x, y });
    }

    let minY = yAutoMin;
    let maxY = yAutoMax;
    if (minY === undefined || maxY === undefined) {
      const ys = points.filter((p) => Number.isFinite(p.y)).map((p) => p.y);
      if (ys.length) {
        const q = (arr: number[], pct: number) => {
          const sorted = [...arr].sort((a, b) => a - b);
          return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * pct))];
        };
        const lo = q(ys, 0.02);
        const hi = q(ys, 0.98);
        const span = Math.max(1e-6, hi - lo);
        const autoMin = lo - span * 0.15;
        const autoMax = hi + span * 0.15;
        minY = yAutoMin ?? autoMin;
        maxY = yAutoMax ?? autoMax;
      } else {
        minY = yAutoMin ?? -10;
        maxY = yAutoMax ?? 10;
      }
    }
    if (minY === maxY) {
      minY -= 1;
      maxY += 1;
    }

    const sx = (x: number) => padding + ((x - xMin) / (xMax - xMin)) * (width - padding * 2);
    const sy = (y: number) => padding + ((maxY - y) / (maxY - minY)) * (height - padding * 2);

    // 生成路径：检测突变（渐近线/不连续）断开线段，超界点贴边裁剪
    const ySpan = Math.max(1e-9, maxY - minY);
    const clipTop = maxY + ySpan * 1.2;
    const clipBottom = minY - ySpan * 1.2;
    let path = "";
    let penDown = false;
    let lastY: number | undefined;
    for (const p of points) {
      // 超出裁剪范围（趋向无穷）→ 抬笔断开
      if (p.y > clipTop || p.y < clipBottom) {
        penDown = false;
        lastY = p.y;
        continue;
      }
      // 相邻两点跨越整个视图范围 → 视为不连续（如渐近线两侧），断开
      if (penDown && lastY !== undefined) {
        const jump = Math.abs(p.y - lastY);
        if (jump > ySpan * 1.8) {
          penDown = false;
        }
      }
      // 贴边裁剪，避免画出 SVG 边界
      const clampedY = Math.min(maxY, Math.max(minY, p.y));
      const command = penDown ? "L" : "M";
      path += `${command}${sx(p.x).toFixed(2)},${sy(clampedY).toFixed(2)} `;
      penDown = true;
      lastY = p.y;
    }

    return { path: path.trim(), domainY: { min: minY, max: maxY }, invalid: hasNaN };
  }, [demo, params]);

  const width = 560;
  const height = 320;
  const padding = 28;
  const xMin = demo.xMin;
  const xMax = demo.xMax;
  const { min: yMin, max: yMax } = domainY;
  const sx = (x: number) => padding + ((x - xMin) / (xMax - xMin)) * (width - padding * 2);
  const sy = (y: number) => padding + ((yMax - y) / (yMax - yMin)) * (height - padding * 2);

  const xTicks = 5;
  const yTicks = 5;

  return (
    <div className="interactive-slider-plot">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={demo.title}
        style={{ width: "100%", height: "auto", display: "block" }}
      >
        {/* 网格 */}
        {Array.from({ length: yTicks + 1 }, (_, i) => {
          const y = yMin + ((yMax - yMin) * i) / yTicks;
          return (
            <line
              key={`gy-${i}`}
              x1={padding}
              x2={width - padding}
              y1={sy(y)}
              y2={sy(y)}
              stroke="var(--color-border-subtle)"
              strokeWidth={1}
            />
          );
        })}
        {Array.from({ length: xTicks + 1 }, (_, i) => {
          const x = xMin + ((xMax - xMin) * i) / xTicks;
          return (
            <line
              key={`gx-${i}`}
              x1={sx(x)}
              x2={sx(x)}
              y1={padding}
              y2={height - padding}
              stroke="var(--color-border-subtle)"
              strokeWidth={1}
            />
          );
        })}
        {/* 坐标轴 */}
        {yMin <= 0 && yMax >= 0 ? (
          <line
            x1={padding}
            x2={width - padding}
            y1={sy(0)}
            y2={sy(0)}
            stroke="var(--color-text-quiet)"
            strokeWidth={1.2}
          />
        ) : null}
        {xMin <= 0 && xMax >= 0 ? (
          <line
            x1={sx(0)}
            x2={sx(0)}
            y1={padding}
            y2={height - padding}
            stroke="var(--color-text-quiet)"
            strokeWidth={1.2}
          />
        ) : null}
        {/* 刻度标签 */}
        {Array.from({ length: xTicks + 1 }, (_, i) => {
          const x = xMin + ((xMax - xMin) * i) / xTicks;
          return (
            <text
              key={`tx-${i}`}
              x={sx(x)}
              y={height - padding + 16}
              textAnchor="middle"
              fontSize={11}
              fill="var(--color-text-muted)"
            >
              {Number(x.toFixed(2))}
            </text>
          );
        })}
        {Array.from({ length: yTicks + 1 }, (_, i) => {
          const y = yMin + ((yMax - yMin) * i) / yTicks;
          return (
            <text
              key={`ty-${i}`}
              x={padding - 8}
              y={sy(y) + 4}
              textAnchor="end"
              fontSize={11}
              fill="var(--color-text-muted)"
            >
              {Number(y.toFixed(2))}
            </text>
          );
        })}
        {/* 函数曲线 */}
        {path ? (
          <path d={path} fill="none" stroke="var(--color-accent)" strokeWidth={2.5} strokeLinecap="round" />
        ) : null}
        {invalid ? (
          <text
            x={width / 2}
            y={height / 2}
            textAnchor="middle"
            fontSize={13}
            fill="var(--color-warning)"
          >
            当前参数下部分区间无定义
          </text>
        ) : null}
      </svg>
      <div className="interactive-slider-axis-labels">
        <span>{demo.xLabel ?? "x"}</span>
        <span>{demo.yLabel ?? "y"}</span>
      </div>
    </div>
  );
}

function SliderControls({
  params,
  values,
  onChange,
}: {
  params: InteractiveSliderParam[];
  values: Record<string, number>;
  onChange: (name: string, value: number) => void;
}) {
  return (
    <div className="interactive-slider-controls">
      {params.map((param) => (
        <label key={param.name} className="interactive-slider-control">
          <span>
            <strong>{param.label}</strong>
            <em>{Number(values[param.name] ?? param.initial).toFixed(2)}</em>
          </span>
          <input
            type="range"
            min={param.min}
            max={param.max}
            step={param.step}
            value={values[param.name] ?? param.initial}
            onChange={(event) => onChange(param.name, Number(event.target.value))}
            aria-label={`${param.label}（${param.name}）`}
          />
        </label>
      ))}
    </div>
  );
}

function SliderDemo({ demo }: { demo: SliderDemo }) {
  const [values, setValues] = useState<Record<string, number>>(() =>
    Object.fromEntries(demo.params.map((param) => [param.name, param.initial])),
  );
  return (
    <div className="interactive-demo interactive-demo--slider">
      <header className="interactive-demo-header">
        <span>可交互演示</span>
        <h4>{demo.title}</h4>
        <p>{demo.instruction}</p>
      </header>
      <FunctionPlot demo={demo} params={values} />
      <SliderControls
        params={demo.params}
        values={values}
        onChange={(name, value) => setValues((current) => ({ ...current, [name]: value }))}
      />
      {demo.note ? <p className="interactive-demo-note">💡 {demo.note}</p> : null}
    </div>
  );
}

/* ---------------- step-animation ---------------- */

function StepAnimationDemo({ demo }: { demo: Extract<InteractiveDemo, { type: "step-animation" }> }) {
  const [revealedCount, setRevealedCount] = useState(1);
  const total = demo.steps.length;
  const current = Math.min(revealedCount, total);
  return (
    <div className="interactive-demo interactive-demo--steps">
      <header className="interactive-demo-header">
        <span>逐步演示</span>
        <h4>{demo.title}</h4>
        {demo.instruction ? <p>{demo.instruction}</p> : null}
      </header>
      <ol className="interactive-step-list">
        {demo.steps.slice(0, current).map((step, index) => (
          <li key={`${step.title}-${index}`}>
            <i>{String(index + 1).padStart(2, "0")}</i>
            <div>
              <strong>{step.title}</strong>
              <p><MathText value={step.body} /></p>
            </div>
          </li>
        ))}
      </ol>
      <div className="interactive-step-actions">
        <span>
          {current} / {total} 步
        </span>
        {current < total ? (
          <button
            className="soft-pill"
            onClick={() => setRevealedCount((count) => count + 1)}
          >
            展开下一步 <span>→</span>
          </button>
        ) : (
          <button className="soft-pill" onClick={() => setRevealedCount(1)}>
            重新开始 <span>↻</span>
          </button>
        )}
      </div>
    </div>
  );
}

/* ---------------- compare ---------------- */

function CompareDemo({ demo }: { demo: Extract<InteractiveDemo, { type: "compare" }> }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const columns = demo.columns;
  // 列数 ≤ 3 时并排展示（一眼对比更直观），超过才用标签切换
  const sideBySide = columns.length <= 3;
  return (
    <div className="interactive-demo interactive-demo--compare">
      <header className="interactive-demo-header">
        <span>对照比较</span>
        <h4>{demo.title}</h4>
        {demo.instruction ? <p>{demo.instruction}</p> : null}
      </header>
      {sideBySide ? (
        <div className="interactive-compare-grid">
          {columns.map((item, index) => (
            <article key={item.label} className="interactive-compare-column">
              <h5>{item.label}</h5>
              <ul className="interactive-compare-list">
                {item.items.map((entry, entryIndex) => (
                  <li key={`${entry}-${entryIndex}`}><MathText value={entry} /></li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      ) : (
        <>
          <div className="interactive-compare-tabs" role="tablist">
            {columns.map((item, index) => (
              <button
                key={item.label}
                role="tab"
                aria-selected={index === activeIndex}
                className={index === activeIndex ? "is-active" : ""}
                onClick={() => setActiveIndex(index)}
              >
                {item.label}
              </button>
            ))}
          </div>
          {columns[activeIndex] ? (
            <ul className="interactive-compare-list">
              {columns[activeIndex].items.map((item, index) => (
                <li key={`${item}-${index}`}><MathText value={item} /></li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </div>
  );
}

/* ---------------- 总入口 ---------------- */

export function InteractiveDemoRenderer({ demo }: { demo: InteractiveDemo }) {
  if (demo.type === "slider") return <SliderDemo demo={demo} />;
  if (demo.type === "step-animation") return <StepAnimationDemo demo={demo} />;
  return <CompareDemo demo={demo} />;
}

export function InteractiveDemoList({ demos }: { demos: InteractiveDemo[] }) {
  if (!demos?.length) return null;
  return (
    <section className="interactive-demo-list" aria-label="可交互演示">
      {demos.map((demo, index) => (
        <InteractiveDemoRenderer key={`${demo.type}-${index}`} demo={demo} />
      ))}
    </section>
  );
}
