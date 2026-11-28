/**
 * 模型接力卡片：拖拽把手 + 供应商/模型名 + 阈值滑动条 + 删除。
 * 拖拽排序走 @dnd-kit/sortable（与 project-sidebar/ProjectNode 同一套），
 * 松手后的顺序由父级 DndContext 的 onDragEnd 落盘。
 */
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Trash2 } from "lucide-react";
import type { ModelRelayEntry } from "@zcode/shared";
import { GradientSlider } from "./GradientSlider.js";

export function ModelRelayCard({
  entry,
  index,
  providerLabel,
  thresholdLabel,
  removeLabel,
  dragHandleLabel,
  onRemove,
  onThresholdChange,
  testId,
}: {
  entry: ModelRelayEntry;
  index: number;
  providerLabel: string;
  thresholdLabel: string;
  removeLabel: string;
  dragHandleLabel: string;
  onRemove: () => void;
  onThresholdChange: (next: number) => void;
  testId: string;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `${entry.providerId}/${entry.modelId}`,
  });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-testid={`${testId}-card`}
      data-card-model={entry.modelId}
      className={
        isDragging
          ? "relative z-10 flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2.5 opacity-80 shadow-lg"
          : "relative z-0 flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2.5"
      }
    >
      <button
        type="button"
        aria-label={dragHandleLabel}
        data-testid={`${testId}-handle`}
        className="-m-1 shrink-0 cursor-grab touch-none rounded-lg p-1 text-remote-foreground-muted hover:text-foreground active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" />
      </button>
      <span className="w-5 shrink-0 text-center text-ui-sm tabular-nums text-remote-foreground-muted">
        {index + 1}
      </span>
      <div className="min-w-0 flex-[0_0_9rem] shrink-0">
        <div className="truncate text-ui-base font-medium text-foreground" title={entry.modelId}>
          {entry.modelId}
        </div>
        <div className="truncate text-ui-sm text-remote-foreground-muted">{providerLabel}</div>
      </div>
      <GradientSlider
        value={entry.thresholdPercent}
        onChange={onThresholdChange}
        disabled={false}
        label={`${entry.modelId} ${thresholdLabel}`}
        testId={`${testId}-slider-${index}`}
      />
      <button
        type="button"
        aria-label={removeLabel}
        data-testid={`${testId}-remove-${index}`}
        className="shrink-0 rounded-lg p-1.5 text-remote-foreground-muted transition-colors hover:bg-surface-hover hover:text-foreground"
        onClick={onRemove}
      >
        <Trash2 className="size-4" />
      </button>
    </li>
  );
}
