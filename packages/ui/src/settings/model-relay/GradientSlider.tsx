/**
 * 阈值滑动条：复用思考强度滑动条的视觉（composer-thought-slider.css 的轨道、
 * 渐变填充与白色圆滑块），取值改为 0–100 连续百分比（步长 1）。
 *
 * 刻意不改动 ComposerModelMenu：那边的滑动条承载「离散档位 + 补间重置」语义，
 * 这边只取同一套 CSS 类；两处共用样式但各自维护结构，避免互相牵动。
 */
import { useId } from "react";
import "@/chat-input-toolbar/composer-thought-slider.css";

export function GradientSlider({
  value,
  onChange,
  disabled = false,
  label,
  testId,
}: {
  value: number;
  onChange: (next: number) => void;
  disabled?: boolean;
  label: string;
  testId?: string;
}) {
  const inputId = useId();
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <div
        className="composer-thought-slider relative h-8 w-full rounded-full"
        data-disabled={disabled}
      >
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div
            data-testid={testId ? `${testId}-track` : undefined}
            data-progress={clamped}
            className="absolute inset-x-0 top-1 h-6 overflow-hidden rounded-full bg-foreground/10"
          >
            <div className="absolute inset-0 rounded-full border border-foreground/10" />
            {/* data-max 常置：思考强度的渐变只在最高档点亮，接力的阈值条全程渐变。 */}
            <div
              className="composer-thought-slider-fill absolute inset-y-0 left-0 overflow-hidden rounded-full"
              data-max="true"
              style={{ width: `calc(14px + (100% - 28px) * ${clamped / 100})` }}
            />
          </div>
          <div
            className="composer-thought-slider-thumb absolute top-0.5 size-7 rounded-full shadow-sm"
            style={{ left: `calc((100% - 28px) * ${clamped / 100})` }}
          />
        </div>
        <input
          id={inputId}
          type="range"
          min={0}
          max={100}
          step={1}
          value={clamped}
          aria-disabled={disabled}
          aria-label={label}
          aria-valuetext={`${clamped}%`}
          data-testid={testId}
          className="composer-thought-range absolute inset-0 m-0 h-8 w-full cursor-pointer appearance-none bg-transparent outline-none aria-disabled:cursor-default"
          onPointerDown={(event) => {
            if (disabled) event.preventDefault();
          }}
          onChange={(event) => {
            if (disabled) return;
            onChange(Number(event.target.value));
          }}
        />
      </div>
      <span
        data-testid={testId ? `${testId}-value` : undefined}
        className="w-12 shrink-0 text-right text-ui-sm tabular-nums text-foreground"
      >
        {clamped}%
      </span>
    </div>
  );
}
