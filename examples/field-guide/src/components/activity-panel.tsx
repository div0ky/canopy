import { CheckCircle2Icon, CircleDotIcon, Clock3Icon, DatabaseIcon } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

export interface ActivityEntry {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly time: string;
  readonly kind: "session" | "model" | "job" | "http";
}

const icons = { session: CheckCircle2Icon, model: DatabaseIcon, job: CircleDotIcon, http: Clock3Icon } as const;

export function ActivityPanel({ entries }: { readonly entries: readonly ActivityEntry[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-display text-2xl">
          <Clock3Icon aria-hidden="true" className="size-5 stroke-[1.5]" />
          Activity
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {entries.length === 0 ? <p className="text-sm text-muted-foreground">Interactions will appear here as they cross the Canopy boundary.</p> : null}
        {entries.map((entry, index) => {
          const Icon = icons[entry.kind];
          return (
            <div key={entry.id} className="flex flex-col gap-4">
              {index > 0 ? <Separator /> : null}
              <div className="grid grid-cols-[auto_1fr_auto] gap-3">
                <Icon aria-hidden="true" className="mt-0.5 size-5 text-primary" />
                <div className="min-w-0"><p className="font-medium">{entry.title}</p><p className="text-xs leading-relaxed text-muted-foreground">{entry.detail}</p></div>
                <time className="font-mono text-xs text-muted-foreground">{entry.time}</time>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
