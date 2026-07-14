import { Badge, EmptyState, PageHeader } from "@engineering-os/ui";

export function FutureFeatureScreen({
  title,
  description
}: {
  readonly title: string;
  readonly description: string;
}) {
  return (
    <div className="screen-layout">
      <PageHeader
        eyebrow="Future milestone"
        title={title}
        description={description}
        actions={<Badge tone="warning">Unavailable</Badge>}
      />
      <EmptyState
        title={`${title} is not available yet`}
        description="This surface is intentionally reserved for a later milestone so the desktop shell does not fake unsupported capabilities."
      />
    </div>
  );
}
