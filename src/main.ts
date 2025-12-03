import { Plugin } from 'obsidian';
import { MapView } from './map-view';
import { TimelineView } from './timeline-view';
import { MapSettings, DEFAULT_SETTINGS, MapSettingTab } from './settings';

export default class ObsidianBasesTimelinePlugin extends Plugin {
		settings: MapSettings;

	async onload() {
		await this.loadSettings();

		this.registerBasesView('map', {
			name: 'Map',
			icon: 'lucide-map',
			factory: (controller, containerEl) => new MapView(controller, containerEl, this),
			options: MapView.getViewOptions,
		});

		this.registerBasesView('timeline', {
			name: 'Timeline',
			icon: 'lucide-timeline',
			factory: (controller, containerEl) => new TimelineView(controller, containerEl, this),
			options: TimelineView.getViewOptions,
		});

		this.addSettingTab(new MapSettingTab(this.app, this));
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	onunload() {
	}
}
