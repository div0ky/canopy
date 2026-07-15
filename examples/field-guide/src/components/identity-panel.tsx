'use client'

import { type FormEvent, useState } from 'react'
import { CheckCircle2Icon, CopyIcon, KeyRoundIcon, LogOutIcon, UserRoundIcon } from 'lucide-react'
import { toast } from 'sonner'

import type { AccessToken, CurrentIdentityResponse } from '@/lib/doxa-client'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'

interface IdentityPanelProps {
  readonly current: CurrentIdentityResponse | undefined
  readonly onAuthenticate: (
    mode: 'login' | 'register',
    credentials: { identifier: string; password: string },
  ) => Promise<void>
  readonly onLogout: () => Promise<void>
  readonly onIssueToken: (name: string) => Promise<{ token: string; accessToken: AccessToken }>
}

export function IdentityPanel({
  current,
  onAuthenticate,
  onLogout,
  onIssueToken,
}: IdentityPanelProps) {
  const [email, setEmail] = useState('ada@example.com')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState<'login' | 'register' | 'logout' | 'token'>()
  const [tokenName, setTokenName] = useState('field-guide')
  const [issuedToken, setIssuedToken] = useState<string>()

  async function authenticate(mode: 'login' | 'register') {
    setPending(mode)
    try {
      await onAuthenticate(mode, { identifier: email, password })
    } catch {
      /* The shell reports normalized Doxa errors. */
    } finally {
      setPending(undefined)
    }
  }

  async function issueToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending('token')
    try {
      const result = await onIssueToken(tokenName)
      setIssuedToken(result.token)
    } catch {
      // The shell reports normalized Doxa errors.
    } finally {
      setPending(undefined)
    }
  }

  return (
    <Card id="identity" className="scroll-mt-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-display text-2xl">
          <UserRoundIcon aria-hidden="true" className="size-5 stroke-[1.5]" />
          Identity
        </CardTitle>
        <CardDescription>
          First-party email/password authentication with an opaque browser session.
        </CardDescription>
        <CardAction>
          <Badge variant={current ? 'secondary' : 'outline'}>
            {current ? 'Authenticated' : 'Anonymous'}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {current ? (
          <>
            <dl className="flex flex-col gap-3 text-sm">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">User</dt>
                <dd className="font-mono">{current.identity.identifier}</dd>
              </div>
              <Separator />
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">Session</dt>
                <dd className="capitalize">
                  {current.authentication.method ?? 'password'} session
                </dd>
              </div>
              <Separator />
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">Email status</dt>
                <dd className="capitalize">{current.identity.verification}</dd>
              </div>
            </dl>
            <Button
              variant="outline"
              className="self-start"
              disabled={pending === 'logout'}
              onClick={async () => {
                setPending('logout')
                try {
                  await onLogout()
                  setIssuedToken(undefined)
                } catch {
                  // The shell reports normalized Doxa errors.
                } finally {
                  setPending(undefined)
                }
              }}
            >
              <LogOutIcon data-icon="inline-start" aria-hidden="true" />
              {pending === 'logout' ? 'Signing out…' : 'Sign out'}
            </Button>
            <Separator />
            <form id="tokens" className="scroll-mt-6" onSubmit={issueToken}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="token-name">Bearer token</FieldLabel>
                  <FieldDescription>
                    Create a constrained opaque credential. Its secret is shown once.
                  </FieldDescription>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      id="token-name"
                      value={tokenName}
                      onChange={(event) => setTokenName(event.target.value)}
                      required
                    />
                    <Button type="submit" variant="secondary" disabled={pending === 'token'}>
                      <KeyRoundIcon data-icon="inline-start" aria-hidden="true" />
                      {pending === 'token' ? 'Creating…' : 'Create token'}
                    </Button>
                  </div>
                </Field>
              </FieldGroup>
            </form>
            {issuedToken ? (
              <Alert>
                <CheckCircle2Icon aria-hidden="true" />
                <AlertTitle>Token created</AlertTitle>
                <AlertDescription className="flex flex-col gap-3">
                  <code className="break-all rounded-md bg-muted p-2 text-xs">{issuedToken}</code>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="self-start"
                    onClick={async () => {
                      await navigator.clipboard.writeText(issuedToken)
                      toast.success('Token copied')
                    }}
                  >
                    <CopyIcon data-icon="inline-start" aria-hidden="true" />
                    Copy token
                  </Button>
                </AlertDescription>
              </Alert>
            ) : null}
          </>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void authenticate('login')
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="password">Password</FieldLabel>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  minLength={8}
                  maxLength={64}
                  aria-describedby="password-requirements"
                  required
                />
                <FieldDescription id="password-requirements">8–64 characters.</FieldDescription>
              </Field>
              <Field orientation="responsive">
                <Button type="submit" disabled={pending !== undefined}>
                  {pending === 'login' ? 'Signing in…' : 'Sign in'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending !== undefined}
                  onClick={() => void authenticate('register')}
                >
                  {pending === 'register' ? 'Registering…' : 'Register and sign in'}
                </Button>
              </Field>
            </FieldGroup>
          </form>
        )}
      </CardContent>
    </Card>
  )
}
