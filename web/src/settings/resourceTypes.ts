export interface ResourceEntry {
  id: string;
  name: string;
  type: "local" | "remote";
  url?: string;
  applyMethod: "css-var" | "data-theme";
  fontStack?: string;
}
