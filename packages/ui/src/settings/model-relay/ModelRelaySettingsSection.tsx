/**
 * 模型接力设置分区（docs/fen-jue/model-relay.md）。
 *
 * 只读写 settings.modelRelayChain：卡片顺序即接力顺序（拖拽松手即保存），
 * 阈值滑动条 0–100%。额度读取与切换执行在 Host 的 model-relay 模块（R2）；
 * 本页只负责配置与展示，不做任何额度判定。
 */
import { useCallback, useMemo, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Plus } from "lucide-react";
import { modelRelayChainSchema, type ModelRelayEntry } from "@zcode/shared";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useSettings } from "@/hooks/useSettingService.js";
import { useProviderSettingsView } from "@/hooks/useProviderSettingsView.js";
import { logger } from "@/logger.js";
import { Button } from "@/components/ui/button.js";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog.js";
import { ModelRelayCard } from "./ModelRelayCard.js";
import { filterUnaddedCandidates, useModelRelayCandidates } from "./useModelRelayCandidates.js";

const DEFAULT_THRESHOLD_PERCENT = 80;
const MAX_CHAIN_LENGTH = 16;

export function ModelRelaySettingsSection() {
  const { intl } = useZCodeIntl();
  const { settings, update } = useSettings();
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  // 卡片展示用供应商名；解析不到时回退 providerId，不引入第二份名称事实。
  const providerView = useProviderSettingsView();
  const providerNames = useMemo(() => {
    const map = new Map<string, string>();
    const viewState = providerView.state;
    if (viewState.status === "ready") {
      for (const provider of viewState.view.providers) {
        map.set(provider.providerId, provider.providerName ?? provider.providerId);
      }
    }
    return map;
  }, [providerView.state]);

  const entries = useMemo<readonly ModelRelayEntry[]>(
    () => settings?.modelRelayChain?.entries ?? [],
    [settings],
  );
  const effective = useMemo<readonly ModelRelayEntry[]>(() => {
    const parsed = modelRelayChainSchema.safeParse({ entries });
    return parsed.success ? parsed.data.entries : entries;
  }, [entries]);

  const save = useCallback(
    async (next: readonly ModelRelayEntry[]) => {
      const parsed = modelRelayChainSchema.safeParse({ entries: next });
      if (!parsed.success) {
        logger.warn("[modelRelay] 拒绝保存不合法的链路", {
          issues: parsed.error.issues.map((issue) => issue.message),
        });
        return;
      }
      try {
        await update({ modelRelayChain: parsed.data });
        setSaveFailed(false);
      } catch (error) {
        logger.error("[modelRelay] 保存链路失败", { error: String(error) });
        setSaveFailed(true);
      }
    },
    [update],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const from = effective.findIndex(
        (entry) => `${entry.providerId}/${entry.modelId}` === active.id,
      );
      const to = effective.findIndex((entry) => `${entry.providerId}/${entry.modelId}` === over.id);
      if (from < 0 || to < 0) return;
      void save(arrayMove([...effective], from, to));
    },
    [effective, save],
  );

  const removeEntry = useCallback(
    (index: number) => {
      void save(effective.filter((_, current) => current !== index));
    },
    [effective, save],
  );

  const addEntry = useCallback(
    (providerId: string, modelId: string) => {
      if (effective.length >= MAX_CHAIN_LENGTH) return;
      void save([
        ...effective,
        { providerId, modelId, thresholdPercent: DEFAULT_THRESHOLD_PERCENT },
      ]);
      setAddDialogOpen(false);
    },
    [effective, save],
  );

  const chainActive = effective.length >= 2;
  const testId = "model-relay";

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-6 py-6">
      <div className="space-y-1">
        <h2 className="text-ui-lg font-semibold text-foreground">
          {intl.formatMessage({ id: "settings.modelRelay.title" })}
        </h2>
        <p className="text-ui-sm text-remote-foreground-muted">
          {intl.formatMessage({ id: "settings.modelRelay.description" })}
        </p>
        {!chainActive ? (
          <p
            data-testid={`${testId}-inactive-hint`}
            className="text-ui-sm text-amber-600 dark:text-amber-400"
          >
            {intl.formatMessage({ id: "settings.modelRelay.needTwo" })}
          </p>
        ) : null}
      </div>

      {effective.length > 0 ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext
            items={effective.map((entry) => `${entry.providerId}/${entry.modelId}`)}
            strategy={verticalListSortingStrategy}
          >
            <ul className="space-y-2" data-testid={`${testId}-list`}>
              {effective.map((entry, index) => (
                <ModelRelayCard
                  key={`${entry.providerId}/${entry.modelId}`}
                  entry={entry}
                  index={index}
                  providerLabel={providerNames.get(entry.providerId) ?? entry.providerId}
                  thresholdLabel={intl.formatMessage({ id: "settings.modelRelay.threshold" })}
                  removeLabel={intl.formatMessage({ id: "settings.modelRelay.remove" })}
                  dragHandleLabel={intl.formatMessage({ id: "settings.modelRelay.dragHandle" })}
                  onRemove={() => removeEntry(index)}
                  onThresholdChange={(next) => {
                    void save(
                      effective.map((current, currentIndex) =>
                        currentIndex === index ? { ...current, thresholdPercent: next } : current,
                      ),
                    );
                  }}
                  testId={testId}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      ) : (
        <div
          data-testid={`${testId}-empty`}
          className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-ui-sm text-remote-foreground-muted"
        >
          {intl.formatMessage({ id: "settings.modelRelay.empty" })}
        </div>
      )}

      {saveFailed ? (
        <p data-testid={`${testId}-save-failed`} className="text-ui-sm text-destructive">
          {intl.formatMessage({ id: "settings.modelRelay.saveFailed" })}
        </p>
      ) : null}

      <Button
        type="button"
        variant="outline"
        data-testid={`${testId}-add`}
        onClick={() => setAddDialogOpen(true)}
      >
        <Plus className="size-4" />
        {intl.formatMessage({ id: "settings.modelRelay.addModel" })}
      </Button>

      <ModelRelayAddDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        entries={effective}
        onAdd={addEntry}
      />
    </div>
  );
}

function ModelRelayAddDialog({
  open,
  onOpenChange,
  entries,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entries: readonly ModelRelayEntry[];
  onAdd: (providerId: string, modelId: string) => void;
}) {
  const { intl } = useZCodeIntl();
  const [query, setQuery] = useState("");
  const { groups, loading, error } = useModelRelayCandidates(open);
  const available = useMemo(() => filterUnaddedCandidates(groups, entries), [entries, groups]);
  const keyword = query.trim().toLowerCase();
  const visible = useMemo(
    () =>
      keyword
        ? available.map((group) => ({
            ...group,
            models: group.models.filter((model) =>
              `${group.providerName} ${model.modelId}`.toLowerCase().includes(keyword),
            ),
          }))
        : available,
    [available, keyword],
  );
  const testId = "model-relay-add";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(80vh,640px)] max-w-xl overflow-hidden p-0">
        <DialogHeader className="border-b border-popover-border px-4 pt-4 pb-3">
          <DialogTitle className="text-ui-lg">
            {intl.formatMessage({ id: "settings.modelRelay.addDialogTitle" })}
          </DialogTitle>
        </DialogHeader>
        <div className="flex min-h-0 flex-col gap-3 px-4 py-4">
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={intl.formatMessage({ id: "settings.modelRelay.addDialogSearch" })}
            data-testid={`${testId}-search`}
            className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-ui-base text-foreground outline-none placeholder:text-remote-foreground-muted"
          />
          {loading ? (
            <p
              data-testid={`${testId}-loading`}
              className="py-4 text-center text-ui-sm text-remote-foreground-muted"
            >
              {intl.formatMessage({ id: "settings.modelRelay.addDialogLoading" })}
            </p>
          ) : error ? (
            <p
              data-testid={`${testId}-error`}
              className="py-4 text-center text-ui-sm text-destructive"
            >
              {intl.formatMessage({ id: "settings.modelRelay.addDialogUnavailable" })}
            </p>
          ) : visible.length === 0 ? (
            <p
              data-testid={`${testId}-no-results`}
              className="py-4 text-center text-ui-sm text-remote-foreground-muted"
            >
              {intl.formatMessage({ id: "settings.modelRelay.addDialogNoResults" })}
            </p>
          ) : (
            <div className="max-h-80 space-y-4 overflow-auto" data-testid={`${testId}-groups`}>
              {visible.map((group) => (
                <div key={group.providerId} className="space-y-1.5">
                  <div className="flex items-center justify-between text-ui-sm">
                    <span className="font-medium text-foreground">{group.providerName}</span>
                    <span className="tabular-nums text-remote-foreground-muted">
                      {group.usedPercent === undefined
                        ? intl.formatMessage({ id: "settings.modelRelay.addDialogNoQuota" })
                        : intl.formatMessage(
                            { id: "settings.modelRelay.addDialogUsed" },
                            { used: Math.round(group.usedPercent) },
                          )}
                    </span>
                  </div>
                  <div className="space-y-1">
                    {group.models.map((model) => (
                      <button
                        key={model.modelId}
                        type="button"
                        data-testid={`${testId}-model-${model.modelId}`}
                        className="flex w-full items-center justify-between rounded-lg border border-border bg-surface px-3 py-2 text-left text-ui-base text-foreground transition-colors hover:bg-surface-hover"
                        onClick={() => onAdd(group.providerId, model.modelId)}
                      >
                        <span className="truncate">{model.modelId}</span>
                        <span className="shrink-0 text-ui-sm tabular-nums text-remote-foreground-muted">
                          {model.usedPercent === undefined
                            ? "—"
                            : `${Math.round(model.usedPercent)}%`}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
