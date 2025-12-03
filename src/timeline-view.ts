import { BasesView, BasesPropertyId, debounce, Keymap, Menu, QueryController, Value, ViewOption } from 'obsidian';
import type ObsidianBasesTimelinePlugin from './main';
import { TimelineConfig, TimelineItem } from './timeline/types';
import { buildTimelineItems, sortByIndexOrDate, assignTracks, detectIndexConflicts, fromAbsoluteDay } from './timeline/algorithms';

export const TimelineViewType = 'timeline';

export class TimelineView extends BasesView {
  type = TimelineViewType;
  scrollEl: HTMLElement;
  containerEl: HTMLElement;
  canvasEl: HTMLElement;
  plugin: ObsidianBasesTimelinePlugin;

  private configCache: TimelineConfig | null = null;
  private scale: number = 8;
  private minScale = 0.1;
  private maxScale = 200;
  private conflicts: Set<string> = new Set();

  constructor(controller: QueryController, scrollEl: HTMLElement, plugin: ObsidianBasesTimelinePlugin) {
    super(controller);
    this.scrollEl = scrollEl;
    this.plugin = plugin;
    this.containerEl = scrollEl.createDiv({ cls: 'bases-timeline-container', attr: { tabIndex: 0 } });
    this.canvasEl = this.containerEl.createDiv('bases-timeline');
  }

  onload(): void {
    this.registerEvent(this.app.workspace.on('css-change', this.onThemeChange, this));
    this.containerEl.addEventListener('wheel', this.onWheelZoom, { passive: false });
  }

  onunload(): void {
    this.containerEl.removeEventListener('wheel', this.onWheelZoom);
  }

  private onThemeChange = (): void => {
    this.renderTimeline();
  };

  private onWheelZoom = (evt: WheelEvent): void => {
    evt.preventDefault();
    const delta = Math.sign(evt.deltaY);
    const factor = delta > 0 ? 0.9 : 1.1;
    const newScale = Math.max(this.minScale, Math.min(this.maxScale, this.scale * factor));
    if (Math.abs(newScale - this.scale) > 0.1) {
      this.scale = newScale;
      this.renderTimeline();
    }
  };

  private onResizeDebounce = debounce(() => this.renderTimeline(), 100, true);

  onResize(): void {
    this.onResizeDebounce();
  }

  public setEphemeralState(state: unknown): void {
    if (!state) return;
    if (state && typeof state === 'object' && 'scale' in state) {
      const s = (state as { scale: number }).scale;
      if (typeof s === 'number') this.scale = Math.max(this.minScale, Math.min(this.maxScale, s));
    }
  }

  public getEphemeralState(): unknown {
    return { scale: this.scale };
  }

  public onDataUpdated(): void {
    this.containerEl.removeClass('is-loading');
    this.renderTimeline();
  }

  private loadConfig(): TimelineConfig {
    const dateStartProp = this.config.getAsPropertyId('dateStart');
    const dateEndProp = this.config.getAsPropertyId('dateEnd');
    const indexProp = this.config.getAsPropertyId('index');
    const calendarProp = this.config.getAsPropertyId('calendar');
    const modeRaw = this.config.get('mode');
    const mode = modeRaw === 'events' ? 'events' : 'notes';
    const pixelsPerDay = this.getNumericConfig('pixelsPerDay', this.scale, 0.1, 200);
    this.scale = pixelsPerDay;
    return { dateStartProp, dateEndProp, indexProp, calendarProp, mode, pixelsPerDay };
  }

  private getNumericConfig(key: string, def: number, min?: number, max?: number): number {
    const value = this.config.get(key);
    if (value == null || typeof value !== 'number') return def;
    let n = value;
    if (min != null) n = Math.max(min, n);
    if (max != null) n = Math.min(max, n);
    return n;
  }

  private clearCanvas(): void {
    this.canvasEl.empty();
  }

  private renderTimeline(): void {
    this.clearCanvas();
    const data = this.data;
    const cfg = this.configCache = this.loadConfig();
    if (!data || !data.data || !cfg.dateStartProp) return;

    const items = buildTimelineItems(data.data, cfg.dateStartProp, cfg.dateEndProp, cfg.indexProp, cfg.calendarProp);
    if (items.length === 0) return;
    const sorted = sortByIndexOrDate(items);
    const assigned = assignTracks(sorted);
    this.conflicts = detectIndexConflicts(sorted);

    const minDay = Math.min(...sorted.map(i => i.range.startDay));
    const maxDay = Math.max(...sorted.map(i => i.range.endDay));
    const totalDays = Math.max(1, maxDay - minDay + 1);
    const trackCount = assigned.tracks.length;
    const axisWidth = 120;
    const columnWidth = 160;
    const width = Math.max(axisWidth + columnWidth * trackCount, axisWidth);
    const height = Math.max(totalDays * this.scale, 200);

    this.canvasEl.style.width = width + 'px';
    this.canvasEl.style.height = height + 'px';

    const axis = this.canvasEl.createDiv('timeline-axis');
    axis.style.height = height + 'px';
    axis.style.width = axisWidth + 'px';
    this.renderAxisLabels(axis, minDay, maxDay);

    for (let t = 0; t < assigned.tracks.length; t++) {
      const trackEl = this.canvasEl.createDiv('timeline-track');
      trackEl.style.left = (axisWidth + t * columnWidth) + 'px';
      trackEl.style.width = columnWidth + 'px';
      for (const item of assigned.tracks[t]) {
        const top = (item.range.startDay - minDay) * this.scale;
        const barHeight = Math.max(6, (item.range.endDay - item.range.startDay + 1) * this.scale);
        const bar = trackEl.createDiv('timeline-bar');
        bar.style.top = top + 'px';
        bar.style.height = barHeight + 'px';
        bar.style.left = '8px';
        bar.style.right = '8px';
        if (this.conflicts.has(item.entry.file.path)) bar.addClass('is-conflict');
        const title = bar.createDiv('timeline-bar-title');
        title.setText(item.entry.file.basename);
        bar.addEventListener('click', (e) => {
          const newLeaf = e instanceof MouseEvent ? Boolean(Keymap.isModEvent(e)) : false;
          void this.app.workspace.openLinkText(item.entry.file.path, '', newLeaf);
        });
        bar.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          const menu = Menu.forEvent(e);
          this.app.workspace.handleLinkContextMenu(menu, item.entry.file.path, '');
          menu.showAtMouseEvent(e);
        });
        bar.addEventListener('mouseover', (e) => {
          this.app.workspace.trigger('hover-link', {
            event: e,
            source: 'bases',
            hoverParent: this.app.renderContext,
            targetEl: this.canvasEl,
            linktext: item.entry.file.path,
          });
        });
      }
    }

    if (cfg.mode === 'events') {
      const cardsEl = this.canvasEl.createDiv('timeline-events-overlay');
      for (const item of sorted) {
        const top = (item.range.startDay - minDay) * this.scale;
        const card = cardsEl.createDiv('timeline-card');
        card.style.top = top + 'px';
        card.setText(item.entry.file.basename);
        card.addEventListener('mouseover', () => cardsEl.addClass('show-lines'));
        card.addEventListener('mouseout', () => cardsEl.removeClass('show-lines'));
        card.addEventListener('click', (e) => {
          const newLeaf = e instanceof MouseEvent ? Boolean(Keymap.isModEvent(e)) : false;
          void this.app.workspace.openLinkText(item.entry.file.path, '', newLeaf);
        });
      }
    }
  }

  static getViewOptions(): ViewOption[] {
    return [
      {
        displayName: 'Mode',
        type: 'dropdown',
        key: 'mode',
        options: { notes: 'Notes', events: 'Events' },
        default: 'notes',
      },
      {
        displayName: 'Display',
        type: 'group',
        items: [
          {
            displayName: 'Pixels per day',
            type: 'slider',
            key: 'pixelsPerDay',
            min: 0.1,
            max: 200,
            step: 0.1,
            default: 8,
          },
        ],
      },
      {
        displayName: 'Properties',
        type: 'group',
        items: [
          {
            displayName: 'Start date',
            type: 'property',
            key: 'dateStart',
            filter: prop => !prop.startsWith('file.'),
            placeholder: 'Property',
          },
          {
            displayName: 'End date',
            type: 'property',
            key: 'dateEnd',
            filter: prop => !prop.startsWith('file.'),
            placeholder: 'Property',
          },
          {
            displayName: 'Index',
            type: 'property',
            key: 'index',
            filter: prop => !prop.startsWith('file.'),
            placeholder: 'Property',
          },
          {
            displayName: 'Calendar',
            type: 'property',
            key: 'calendar',
            filter: prop => !prop.startsWith('file.'),
            placeholder: 'Property',
          },
        ],
      },
    ];
  }

  private renderAxisLabels(axisEl: HTMLElement, minDay: number, maxDay: number): void {
    const totalDays = Math.max(1, maxDay - minDay + 1);
    const interval = this.getTickInterval(this.scale);
    for (let day = minDay; day <= maxDay; day += interval) {
      const top = (day - minDay) * this.scale;
      const tick = axisEl.createDiv('timeline-axis-tick');
      tick.style.top = top + 'px';
      const label = tick.createDiv('timeline-axis-label');
      const { y, m, d } = fromAbsoluteDay(day);
      label.setText(`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`);
    }
  }

  private getTickInterval(scale: number): number {
    if (scale <= 0.2) return 365;
    if (scale <= 0.5) return 120;
    if (scale <= 1) return 30;
    if (scale <= 2) return 7;
    if (scale <= 5) return 1;
    return 1;
  }
}

