"use client";
import { SubNav } from "@/components/shell/app-shell";
import { SourceTag } from "@/components/domain/policy-card";
import { PageHeader } from "@/components/ui/core";
import { services } from "@/services";

export function SentinelHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Sentinel account" title={title} description={description} actions={<SourceTag source={services.account.source} />} />
      <SubNav
        items={[
          { href: "/sentinel", label: "Portfolio" },
          { href: "/sentinel/policy", label: "Policy" },
          { href: "/sentinel/activity", label: "Activity" },
        ]}
      />
    </div>
  );
}
