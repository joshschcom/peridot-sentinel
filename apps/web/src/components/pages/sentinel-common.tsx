"use client";
import { SourceTag } from "@/components/domain/policy-card";
import { PageHeader } from "@/components/ui/core";
import { services } from "@/services";

/** Header of the pages that show a Sentinel account. Portfolio and Activity are navigation entries of their own. */
export function SentinelHeader({ title, description, eyebrow = "Sentinel account", actions }: { title: string; description: string; eyebrow?: string; actions?: React.ReactNode }) {
  return (
    <PageHeader
      eyebrow={eyebrow}
      title={title}
      description={description}
      actions={
        <>
          <SourceTag source={services.account.source} />
          {actions}
        </>
      }
    />
  );
}
