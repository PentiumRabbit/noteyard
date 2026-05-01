export interface Template {
  id: string;
  name: string;
  icon: string;
  description: string;
  blocks: object[];
}

export const TEMPLATES: Template[] = [
  {
    id: "meeting-notes",
    name: "会议记录",
    icon: "📝",
    description: "议题、决策、待办",
    blocks: [
      { type: "heading", props: { level: "2" }, content: [{ type: "text", text: "会议信息", styles: {} }] },
      { type: "paragraph", props: {}, content: [{ type: "text", text: "日期：", styles: {} }] },
      { type: "paragraph", props: {}, content: [{ type: "text", text: "参与人：", styles: {} }] },
      { type: "heading", props: { level: "2" }, content: [{ type: "text", text: "议题", styles: {} }] },
      { type: "bulletListItem", props: {}, content: [{ type: "text", text: "议题 1", styles: {} }] },
      { type: "bulletListItem", props: {}, content: [{ type: "text", text: "议题 2", styles: {} }] },
      { type: "heading", props: { level: "2" }, content: [{ type: "text", text: "决策", styles: {} }] },
      { type: "bulletListItem", props: {}, content: [{ type: "text", text: "决策 1", styles: {} }] },
      { type: "heading", props: { level: "2" }, content: [{ type: "text", text: "待办事项", styles: {} }] },
      { type: "checkListItem", props: { checked: "false" }, content: [{ type: "text", text: "待办 1", styles: {} }] },
      { type: "checkListItem", props: { checked: "false" }, content: [{ type: "text", text: "待办 2", styles: {} }] },
    ],
  },
  {
    id: "weekly-review",
    name: "周报",
    icon: "📊",
    description: "本周完成、下周计划、问题反馈",
    blocks: [
      { type: "callout", props: { icon: "📅" }, content: [{ type: "text", text: "周报周期：", styles: {} }] },
      { type: "heading", props: { level: "2" }, content: [{ type: "text", text: "本周完成", styles: {} }] },
      { type: "checkListItem", props: { checked: "true" }, content: [{ type: "text", text: "事项 1", styles: {} }] },
      { type: "checkListItem", props: { checked: "true" }, content: [{ type: "text", text: "事项 2", styles: {} }] },
      { type: "heading", props: { level: "2" }, content: [{ type: "text", text: "下周计划", styles: {} }] },
      { type: "checkListItem", props: { checked: "false" }, content: [{ type: "text", text: "计划 1", styles: {} }] },
      { type: "checkListItem", props: { checked: "false" }, content: [{ type: "text", text: "计划 2", styles: {} }] },
      { type: "heading", props: { level: "2" }, content: [{ type: "text", text: "问题 / 风险", styles: {} }] },
      { type: "bulletListItem", props: {}, content: [{ type: "text", text: "暂无", styles: {} }] },
    ],
  },
  {
    id: "project-brief",
    name: "项目简报",
    icon: "🚀",
    description: "背景、目标、里程碑、负责人",
    blocks: [
      { type: "heading", props: { level: "1" }, content: [{ type: "text", text: "项目名称", styles: {} }] },
      { type: "callout", props: { icon: "💡" }, content: [{ type: "text", text: "一句话描述项目目标", styles: {} }] },
      { type: "heading", props: { level: "2" }, content: [{ type: "text", text: "背景", styles: {} }] },
      { type: "paragraph", props: {}, content: [{ type: "text", text: "说明项目背景和痛点…", styles: {} }] },
      { type: "heading", props: { level: "2" }, content: [{ type: "text", text: "目标", styles: {} }] },
      { type: "bulletListItem", props: {}, content: [{ type: "text", text: "目标 1", styles: {} }] },
      { type: "bulletListItem", props: {}, content: [{ type: "text", text: "目标 2", styles: {} }] },
      { type: "heading", props: { level: "2" }, content: [{ type: "text", text: "里程碑", styles: {} }] },
      { type: "bulletListItem", props: {}, content: [{ type: "text", text: "M1：", styles: {} }] },
      { type: "bulletListItem", props: {}, content: [{ type: "text", text: "M2：", styles: {} }] },
      { type: "heading", props: { level: "2" }, content: [{ type: "text", text: "负责人", styles: {} }] },
      { type: "paragraph", props: {}, content: [{ type: "text", text: "PM：", styles: {} }] },
    ],
  },
  {
    id: "reading-notes",
    name: "读书笔记",
    icon: "📚",
    description: "书名、作者、摘要、感想",
    blocks: [
      { type: "heading", props: { level: "2" }, content: [{ type: "text", text: "书目信息", styles: {} }] },
      { type: "paragraph", props: {}, content: [{ type: "text", text: "书名：", styles: {} }] },
      { type: "paragraph", props: {}, content: [{ type: "text", text: "作者：", styles: {} }] },
      { type: "paragraph", props: {}, content: [{ type: "text", text: "阅读日期：", styles: {} }] },
      { type: "heading", props: { level: "2" }, content: [{ type: "text", text: "核心摘要", styles: {} }] },
      { type: "quote", props: {}, content: [{ type: "text", text: "最打动你的一段话", styles: {} }] },
      { type: "heading", props: { level: "2" }, content: [{ type: "text", text: "关键笔记", styles: {} }] },
      { type: "bulletListItem", props: {}, content: [{ type: "text", text: "笔记 1", styles: {} }] },
      { type: "bulletListItem", props: {}, content: [{ type: "text", text: "笔记 2", styles: {} }] },
      { type: "heading", props: { level: "2" }, content: [{ type: "text", text: "个人感想", styles: {} }] },
      { type: "paragraph", props: {}, content: [{ type: "text", text: "写下你的思考…", styles: {} }] },
    ],
  },
];
