import {
  BookOpenIcon,
  BotIcon,
  BriefcaseIcon,
  CalendarDaysIcon,
  ChartColumnIcon,
  CodeIcon,
  CreditCardIcon,
  ExternalLinkIcon,
  FileTextIcon,
  FlaskConicalIcon,
  GitBranchIcon,
  GraduationCapIcon,
  LayersIcon,
  FolderIcon,
  LinkIcon,
  MailIcon,
  MapIcon,
  NewspaperIcon,
  PuzzleIcon,
  RocketIcon,
  ShieldCheckIcon,
  SparklesIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react";

/** 导航图标白名单：数据库与栏目 manifest 只能引用这些名称。 */
export const NAV_ICONS = {
  link: LinkIcon,
  "external-link": ExternalLinkIcon,
  "file-text": FileTextIcon,
  "book-open": BookOpenIcon,
  calendar: CalendarDaysIcon,
  wrench: WrenchIcon,
  briefcase: BriefcaseIcon,
  newspaper: NewspaperIcon,
  layers: LayersIcon,
  folder: FolderIcon,
  "credit-card": CreditCardIcon,
  "shield-check": ShieldCheckIcon,
  mail: MailIcon,
  bot: BotIcon,
  code: CodeIcon,
  "git-branch": GitBranchIcon,
  flask: FlaskConicalIcon,
  "graduation-cap": GraduationCapIcon,
  chart: ChartColumnIcon,
  map: MapIcon,
  puzzle: PuzzleIcon,
  rocket: RocketIcon,
  sparkles: SparklesIcon,
} satisfies Record<string, LucideIcon>;

export type NavIconName = keyof typeof NAV_ICONS;
export const NAV_ICON_NAMES = Object.keys(NAV_ICONS) as NavIconName[];

export function isNavIconName(value: string): value is NavIconName {
  return Object.hasOwn(NAV_ICONS, value);
}

export function navIcon(name: string): LucideIcon {
  return isNavIconName(name) ? NAV_ICONS[name] : LinkIcon;
}
