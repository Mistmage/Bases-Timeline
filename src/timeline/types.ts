import { BasesEntry, BasesPropertyId } from 'obsidian';

export interface TimelineConfig {
  dateStartProp: BasesPropertyId | null;
  dateEndProp: BasesPropertyId | null;
  indexProp: BasesPropertyId | null;
  calendarProp: BasesPropertyId | null;
  mode: 'notes' | 'events';
  pixelsPerDay: number;
}

export interface NormalizedDateRange {
  startDay: number;
  endDay: number;
}

export interface TimelineItem {
  entry: BasesEntry;
  range: NormalizedDateRange;
  indexValue: number | null;
}

export interface TrackAssignmentResult {
  tracks: TimelineItem[][];
}

