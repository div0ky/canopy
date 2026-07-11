"use client";

import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { CheckIcon, MenuIcon } from "lucide-react";
import { toast } from "sonner";

import { canopyRequest, CanopyClientError, type AccessToken, type CurrentIdentityResponse, type Identity } from "@/lib/canopy-client";
import { ActivityPanel, type ActivityEntry } from "@/components/activity-panel";
import { AppSidebar } from "@/components/app-sidebar";
import { CounterPanel } from "@/components/counter-panel";
import { IdentityPanel } from "@/components/identity-panel";
import { PublicHttpPanel } from "@/components/public-http-panel";
import { Badge } from "@/components/ui/badge";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";

function now() {
  return new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date());
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "The Canopy request failed.";
}

export function FieldGuide() {
  const [connected, setConnected] = useState(false);
  const [current, setCurrent] = useState<CurrentIdentityResponse>();
  const [counterValue, setCounterValue] = useState<number>();
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const initialized = useRef(false);

  const record = useCallback((entry: Omit<ActivityEntry, "id" | "time">) => {
    setActivity((existing) => [{ ...entry, id: crypto.randomUUID(), time: now() }, ...existing].slice(0, 5));
  }, []);

  const refreshIdentity = useCallback(async () => {
    try {
      const identity = await canopyRequest<CurrentIdentityResponse>("/auth/me");
      setCurrent(identity);
      return identity;
    } catch (error) {
      if (error instanceof CanopyClientError && error.status === 401) {
        setCurrent(undefined);
        return undefined;
      }
      throw error;
    }
  }, []);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    void Promise.allSettled([
      canopyRequest<{ status: string }>("/health").then((health) => {
        setConnected(health.status === "ok");
        record({ title: "Canopy connected", detail: "GET /health returned ok", kind: "http" });
      }),
      refreshIdentity().then((identity) => {
        if (identity) record({ title: "Session resolved", detail: `Password session established for ${identity.identity.email}`, kind: "session" });
      }),
    ]);
  }, [record, refreshIdentity]);

  async function handle<Output>(work: () => Promise<Output>): Promise<Output> {
    try { return await work(); } catch (error) {
      toast.error(errorMessage(error));
      throw error;
    }
  }

  return (
    <SidebarProvider style={{ "--sidebar-width": "15rem" } as CSSProperties}>
      <AppSidebar />
      <SidebarInset id="overview" className="min-w-0 bg-transparent">
        <header className="flex items-center justify-between border-b px-4 py-3 md:hidden">
          <div className="flex items-center gap-2"><SidebarTrigger><MenuIcon aria-hidden="true" /></SidebarTrigger><span className="font-display text-xl">Canopy</span></div>
          <Badge variant={connected ? "secondary" : "outline"}>{connected ? "Connected" : "Connecting"}</Badge>
        </header>
        <div className="mx-auto flex w-full max-w-[1240px] flex-1 flex-col px-4 py-8 sm:px-6 lg:px-10 lg:py-12">
          <header className="mb-8 flex flex-col justify-between gap-5 border-b pb-7 sm:flex-row sm:items-start">
            <div>
              <h1 className="font-display text-5xl leading-none tracking-tight sm:text-6xl">Field Guide</h1>
              <p className="mt-3 max-w-2xl text-base text-muted-foreground sm:text-lg">A living integration check for the Canopy application model.</p>
            </div>
            <div className="hidden items-center gap-3 sm:flex">
              <div className="text-right"><p className="font-medium">Canopy API</p><p className="text-sm text-muted-foreground">{connected ? "Connected" : "Unavailable"}</p></div>
              <span className="flex size-11 items-center justify-center rounded-full border bg-card"><CheckIcon aria-hidden="true" className="size-5 text-primary" /></span>
            </div>
          </header>
          <main className="grid flex-1 gap-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.9fr)]">
            <div className="flex min-w-0 flex-col gap-6">
              <PublicHttpPanel
                connected={connected}
                onHello={(name) => handle(async () => {
                  const result = await canopyRequest<{ message: string }>(`/hello/${encodeURIComponent(name)}`);
                  record({ title: "Public route called", detail: `GET /hello/${name}`, kind: "http" });
                  return result.message;
                })}
              />
              <IdentityPanel
                current={current}
                onAuthenticate={(mode, credentials) => handle(async () => {
                  if (mode === "register") await canopyRequest<{ identity: Identity }>("/auth/register", { method: "POST", body: JSON.stringify(credentials) });
                  await canopyRequest("/auth/login", { method: "POST", body: JSON.stringify(credentials) });
                  const identity = await refreshIdentity();
                  if (identity) record({ title: "Session resolved", detail: `Password session established for ${identity.identity.email}`, kind: "session" });
                  toast.success(mode === "register" ? "Identity registered and signed in" : "Signed in");
                })}
                onLogout={() => handle(async () => {
                  await canopyRequest("/auth/logout", { method: "POST" });
                  setCurrent(undefined);
                  record({ title: "Session revoked", detail: "POST /auth/logout cleared the browser session", kind: "session" });
                  toast.success("Signed out");
                })}
                onIssueToken={(name) => handle(async () => {
                  const grant = await canopyRequest<{ token: string; accessToken: AccessToken }>("/auth/tokens", { method: "POST", body: JSON.stringify({ name, constraints: ["counters.write"] }) });
                  record({ title: "Bearer token issued", detail: `${grant.accessToken.displayPrefix}… with counters.write`, kind: "session" });
                  toast.success("Bearer token created");
                  return grant;
                })}
              />
            </div>
            <aside className="flex min-w-0 flex-col gap-6">
              <CounterPanel
                authenticated={Boolean(current)}
                value={counterValue}
                onIncrement={(id, amount) => handle(async () => {
                  const result = await canopyRequest<{ id: string; value: number; version: number; jobId: string }>(`/secure/counters/${encodeURIComponent(id)}/increment`, { method: "POST", body: JSON.stringify({ amount }) });
                  setCounterValue(result.value);
                  record({ title: "Job queued", detail: `${result.jobId} queued after the model transaction`, kind: "job" });
                  record({ title: "counter.saved", detail: `${result.id} updated to ${result.value} at version ${result.version}`, kind: "model" });
                  toast.success(`Counter updated to ${result.value}`);
                })}
              />
              <ActivityPanel entries={activity} />
            </aside>
          </main>
        </div>
        <footer className="flex flex-col gap-3 border-t px-5 py-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>Next.js <span aria-hidden="true">·</span> Tailwind <span aria-hidden="true">·</span> shadcn/ui <span aria-hidden="true">·</span> Canopy</p>
          <div className="flex items-center gap-2"><span className="size-2 rounded-full bg-primary" aria-hidden="true" />{connected ? "All systems operational" : "Canopy API unavailable"}</div>
        </footer>
      </SidebarInset>
    </SidebarProvider>
  );
}
