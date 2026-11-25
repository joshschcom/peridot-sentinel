"use client";
import { SubNav } from "@/components/shell/app-shell";
import { SourceTag } from "@/components/domain/policy-card";
import { PageHeader } from "@/components/ui/core";
import { services } from "@/services";

export function SentinelHeader({ description }: { description: string }) {
  return (
    <div className="space-y-5">
      <PageHeader title="Sentinel" description={description} actions={<SourceTag source={services.account.source} />} />
      <SubNav
        items={[
          { href: "/sentinel", label: "Overview" },
          { href: "/sentinel/policy", label: "Policy and automation" },
          { href: "/sentinel/activity", label: "Activity" },
        ]}
      />
    </div>
  );
}
