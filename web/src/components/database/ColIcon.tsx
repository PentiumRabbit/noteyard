// ColIcon.tsx — Column type icon component and related constants
import { Type, Hash, CheckSquare, ChevronDown, Tags, Calendar, FunctionSquare, Link, Mail, Clock, Clock3, Paperclip, ArrowUpRight, Sigma, HelpCircle, Phone, User, Circle } from "lucide-react";

export const COL_ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  text: Type,
  number: Hash,
  checkbox: CheckSquare,
  select: ChevronDown,
  "multi-select": Tags,
  date: Calendar,
  formula: FunctionSquare,
  url: Link,
  email: Mail,
  created_time: Clock,
  last_edited_time: Clock3,
  files: Paperclip,
  relation: ArrowUpRight,
  rollup: Sigma,
  phone: Phone,
  people: User,
  status: Circle,
};

export function ColIcon({ type, size = 14, className }: { type: string; size?: number; className?: string }) {
  const Icon = COL_ICONS[type] ?? HelpCircle;
  return <Icon size={size} className={className} />;
}
