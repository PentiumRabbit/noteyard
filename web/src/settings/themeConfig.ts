import type { ResourceEntry } from "./resourceTypes";

export const THEMES: ResourceEntry[] = [
  {
    id: "default-light",
    name: "默认亮色",
    type: "local",
    applyMethod: "data-theme",
  },
  {
    id: "dark",
    name: "暗色",
    type: "local",
    applyMethod: "data-theme",
  },
  {
    id: "warm",
    name: "暖米色",
    type: "local",
    applyMethod: "data-theme",
  },
  {
    id: "aurora",
    name: "极光",
    type: "remote",
    applyMethod: "data-theme",
    url: "/themes/aurora.css",
  },
  {
    id: "forest",
    name: "森林",
    type: "remote",
    applyMethod: "data-theme",
    url: "/themes/forest.css",
  },
];

export const DEFAULT_THEME_ID = "default-light";
