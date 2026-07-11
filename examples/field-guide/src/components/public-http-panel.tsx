"use client";

import { type FormEvent, useState } from "react";
import { CircleCheckIcon, Globe2Icon, PlayIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

interface PublicHttpPanelProps {
  readonly connected: boolean;
  readonly onHello: (name: string) => Promise<string>;
}

export function PublicHttpPanel({ connected, onHello }: PublicHttpPanelProps) {
  const [name, setName] = useState("Ada");
  const [response, setResponse] = useState("Ready to call GET /hello/:name");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    try { setResponse(await onHello(name)); } catch { setResponse("The request failed. See the notification for details."); } finally { setPending(false); }
  }

  return (
    <Card id="http" className="scroll-mt-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-display text-2xl">
          <Globe2Icon aria-hidden="true" className="size-5 stroke-[1.5]" />
          Public HTTP
        </CardTitle>
        <CardDescription>Exercise Canopy routes through the same-origin Next.js transport.</CardDescription>
        <CardAction>
          <Badge variant={connected ? "secondary" : "destructive"}>
            <CircleCheckIcon aria-hidden="true" />
            {connected ? "Connected" : "Unavailable"}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <span className="font-medium">Health</span>
          <span className="font-mono text-sm text-muted-foreground">{connected ? "ok" : "offline"}</span>
        </div>
        <Separator />
        <form onSubmit={submit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="greeting-name">Greeting</FieldLabel>
              <FieldDescription>Call the public hello endpoint.</FieldDescription>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input id="greeting-name" value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" required />
                <Button type="submit" size="lg" disabled={pending || !connected}>
                  <PlayIcon data-icon="inline-start" aria-hidden="true" />
                  {pending ? "Calling…" : "Say hello"}
                </Button>
              </div>
            </Field>
            <Field>
              <FieldLabel htmlFor="hello-response">Response</FieldLabel>
              <output id="hello-response" className="min-h-20 rounded-lg border bg-muted/45 p-4 font-mono text-sm text-primary">{response}</output>
            </Field>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
