import {
  BookOpenIcon,
  CalendarDaysIcon,
  FileIcon,
  WrenchIcon,
} from "lucide-react";

import {
  ContentCard,
  ContentCardAction,
  ContentCardChip,
} from "@/components/cards/content-card";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatDateTime, formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SeriesType } from "@/types/database";
import type { AlbumCardData, AlbumManifestItem } from "@/types/content";

const KIND_META: Record<
  SeriesType,
  { label: string; Icon: typeof BookOpenIcon }
> = {
  collection: { label: "普通专辑", Icon: BookOpenIcon },
  handbook: { label: "手册", Icon: BookOpenIcon },
  skill: { label: "技能", Icon: WrenchIcon },
  event: { label: "活动", Icon: CalendarDaysIcon },
};

const EVENT_STATE_META = {
  upcoming: { tone: "event-upcoming" as const, label: "即将开始" },
  registering: { tone: "event-registering" as const, label: "报名中" },
  ended: { tone: "event-ended" as const, label: "已结束" },
};

export function AlbumCoverPlaceholder({
  kind,
  className,
}: {
  kind: SeriesType;
  className?: string;
}) {
  const { Icon } = KIND_META[kind];
  return (
    <div className={cn("opc-content-card-placeholder", className)} aria-hidden>
      <Icon className="size-5" />
    </div>
  );
}

function ManifestPreview({ files }: { files: AlbumManifestItem[] }) {
  return (
    <ul className="opc-content-card-manifest">
      {files.slice(0, 3).map((file) => (
        <li key={file.path}>
          <FileIcon className="size-3 shrink-0" aria-hidden />
          <span className="truncate">{file.path}</span>
          {file.size > 0 ? (
            <span className="ml-auto shrink-0">
              {(file.size / 1024).toFixed(0)}K
            </span>
          ) : null}
        </li>
      ))}
      {files.length > 3 ? <li>… 共 {files.length} 个文件</li> : null}
    </ul>
  );
}

export function AudienceChips({ audiences }: { audiences: string[] }) {
  if (audiences.length === 0) return null;
  return (
    <span className="opc-content-card-tags">
      {audiences.map((audience) => (
        <Badge key={audience} variant="outline">
          {audience}
        </Badge>
      ))}
    </span>
  );
}

export function AlbumCard({
  data,
  timezone = "Asia/Shanghai",
}: {
  data: AlbumCardData;
  timezone?: string;
}) {
  const kind = KIND_META[data.kind];
  const paid = data.price !== null && data.price > 0;
  const event = data.event ?? null;
  const eventState = event ? EVENT_STATE_META[event.state] : null;

  return (
    <ContentCard href={data.href} kind={data.kind}>
      <div className="opc-content-card-cover">
        {data.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- Cover is hosted or configured by the site owner.
          <img src={data.coverUrl} alt="" className="opc-content-card-image" />
        ) : data.manifest && data.manifest.length > 0 ? (
          <ManifestPreview files={data.manifest} />
        ) : (
          <AlbumCoverPlaceholder kind={data.kind} />
        )}
        <ContentCardChip>{data.tags[0] ?? kind.label}</ContentCardChip>
      </div>
      <div className="opc-content-card-body">
        <div className="opc-content-card-heading">
          <h3 className="opc-content-card-title">{data.title}</h3>
          {data.owned ? (
            <StatusBadge tone="owned">已购</StatusBadge>
          ) : event && eventState ? (
            <StatusBadge tone={eventState.tone}>{eventState.label}</StatusBadge>
          ) : data.price === null ? <StatusBadge tone="neutral">版本准备中</StatusBadge> : paid ? (
            <StatusBadge tone="paid">
              {formatPrice(data.price!, data.currency)}
            </StatusBadge>
          ) : (
            <StatusBadge tone="free">免费</StatusBadge>
          )}
        </div>
        {data.summary ? (
          <p className="opc-content-card-summary">{data.summary}</p>
        ) : null}
        <AudienceChips audiences={data.audiences} />
        <div className="opc-content-card-footer">
          <span className="opc-content-card-meta">
            <span>{kind.label}</span>
            {typeof data.chapterCount === "number" && data.chapterCount > 0 ? (
              <span>{data.chapterCount} 章</span>
            ) : null}
            {event ? (
              <>
                <time dateTime={event.startsAt}>
                  {formatDateTime(event.startsAt, timezone)}
                </time>
                <span>
                  {event.ticketPrice === null
                    ? "票价待定"
                    : event.ticketPrice === 0
                      ? "免费参加"
                      : `票价 ${formatPrice(event.ticketPrice, data.currency)}`}
                </span>
              </>
            ) : null}
            {data.tags.slice(1, 3).map((tag) => (
              <span key={tag}>#{tag}</span>
            ))}
          </span>
          <ContentCardAction>浏览</ContentCardAction>
        </div>
      </div>
    </ContentCard>
  );
}
