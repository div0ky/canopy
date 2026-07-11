'use client'

import { useState } from 'react'
import { LeafIcon, MinusIcon, PlusIcon, TrendingUpIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'

interface CounterPanelProps {
  readonly authenticated: boolean
  readonly value: number | undefined
  readonly onIncrement: (id: string, amount: number) => Promise<void>
}

export function CounterPanel({ authenticated, value, onIncrement }: CounterPanelProps) {
  const [id, setId] = useState('frontend-proof')
  const [amount, setAmount] = useState(1)
  const [pending, setPending] = useState(false)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-display text-2xl">
          <LeafIcon aria-hidden="true" className="size-5 stroke-[1.5]" />
          Counter specimen
        </CardTitle>
        <CardDescription>
          Protected action that mutates a model and queues durable work.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <Field>
          <FieldLabel htmlFor="counter-id">Specimen ID</FieldLabel>
          <Input
            id="counter-id"
            value={id}
            onChange={(event) => setId(event.target.value)}
            className="font-mono"
            required
          />
        </Field>
        <div className="flex items-end justify-between">
          <span className="text-sm text-muted-foreground">Current value</span>
          <output className="font-display text-4xl text-primary">{value ?? '—'}</output>
        </div>
        <Separator />
        <Field>
          <FieldLabel>Amount</FieldLabel>
          <div className="grid grid-cols-[auto_1fr_auto] overflow-hidden rounded-lg border bg-background">
            <Button
              type="button"
              variant="ghost"
              size="icon-lg"
              className="rounded-none border-r"
              onClick={() => setAmount((current) => Math.max(1, current - 1))}
              aria-label="Decrease amount"
            >
              <MinusIcon aria-hidden="true" />
            </Button>
            <output className="flex items-center justify-center font-mono">{amount}</output>
            <Button
              type="button"
              variant="ghost"
              size="icon-lg"
              className="rounded-none border-l"
              onClick={() => setAmount((current) => current + 1)}
              aria-label="Increase amount"
            >
              <PlusIcon aria-hidden="true" />
            </Button>
          </div>
        </Field>
        <Button
          type="button"
          variant="secondary"
          size="lg"
          disabled={!authenticated || pending}
          onClick={async () => {
            setPending(true)
            try {
              await onIncrement(id, amount)
            } catch {
              /* The shell reports normalized Canopy errors. */
            } finally {
              setPending(false)
            }
          }}
        >
          <TrendingUpIcon data-icon="inline-start" aria-hidden="true" />
          {pending ? 'Incrementing…' : authenticated ? 'Increment' : 'Sign in to increment'}
        </Button>
      </CardContent>
    </Card>
  )
}
