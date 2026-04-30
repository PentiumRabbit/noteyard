import { match } from "pinyin-pro";

/**
 * 判断字符串是否匹配查询词（支持中文、拼音全拼、首字母缩写）
 */
export function pinyinMatch(text: string, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  // 直接子串匹配（英文/数字）
  if (text.toLowerCase().includes(q)) return true;
  // 拼音匹配（全拼 + 首字母缩写）
  const result = match(text, q, { precision: "start" });
  return result !== null;
}
