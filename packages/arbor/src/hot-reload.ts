import { watch, type FSWatcher } from 'node:fs'
import { createHash } from 'node:crypto'
import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'

export interface HotReloadTarget {
  stop(): void | Promise<void>
}

export interface HotReloadSupervisorOptions {
  readonly watchPaths: readonly string[]
  readonly build: () => void | Promise<void>
  readonly start: () => HotReloadTarget | Promise<HotReloadTarget>
  readonly debounceMilliseconds?: number
  readonly onWatching?: (paths: readonly string[]) => void
  readonly onChange?: (path: string, event: string) => void
  readonly onReloaded?: () => void
  readonly onError?: (error: unknown, phase: 'watch' | 'build' | 'replace') => void
}

/**
 * Rebuilds before replacing the live target, so invalid edits never take down the last good app.
 * Runtime targets are process-isolated because Node ESM dependencies cannot be safely evicted.
 */
export class HotReloadSupervisor implements HotReloadTarget {
  readonly #options: HotReloadSupervisorOptions
  readonly #watchers: FSWatcher[] = []
  #target: HotReloadTarget | undefined
  #timer: NodeJS.Timeout | undefined
  #reloadRequested = false
  #forceReloadRequested = false
  #reloadPromise: Promise<void> | undefined
  #stopping = false
  #fingerprint = ''

  private constructor(options: HotReloadSupervisorOptions) {
    this.#options = options
  }

  static async start(options: HotReloadSupervisorOptions): Promise<HotReloadSupervisor> {
    const supervisor = new HotReloadSupervisor(options)
    await options.build()
    supervisor.#target = await options.start()
    supervisor.#fingerprint = await fingerprint(options.watchPaths)
    supervisor.#beginWatching()
    return supervisor
  }

  requestReload(force = true): Promise<void> {
    if (this.#stopping) return Promise.resolve()
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = undefined
    this.#reloadRequested = true
    this.#forceReloadRequested ||= force
    if (!this.#reloadPromise) {
      this.#reloadPromise = this.#drainReloads().finally(() => { this.#reloadPromise = undefined })
    }
    return this.#reloadPromise
  }

  async stop(): Promise<void> {
    if (this.#stopping) return
    this.#stopping = true
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = undefined
    for (const watcher of this.#watchers.splice(0)) watcher.close()
    await this.#reloadPromise
    const target = this.#target
    this.#target = undefined
    await target?.stop()
  }

  #beginWatching(): void {
    for (const watchPath of this.#options.watchPaths) {
      const watcher = watch(watchPath, { recursive: true }, (event, filename) => {
        this.#options.onChange?.(filename ? `${watchPath}/${filename}` : watchPath, event)
        this.#scheduleReload()
      })
      watcher.on('error', (error) => this.#options.onError?.(error, 'watch'))
      this.#watchers.push(watcher)
    }
    this.#options.onWatching?.(this.#options.watchPaths)
  }

  #scheduleReload(): void {
    if (this.#stopping) return
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = setTimeout(() => {
      this.#timer = undefined
      void this.requestReload(false)
    }, this.#options.debounceMilliseconds ?? 100)
    this.#timer.unref()
  }

  async #drainReloads(): Promise<void> {
    while (this.#reloadRequested && !this.#stopping) {
      this.#reloadRequested = false
      const force = this.#forceReloadRequested
      this.#forceReloadRequested = false
      const candidateFingerprint = await fingerprint(this.#options.watchPaths)
      if (!force && candidateFingerprint === this.#fingerprint) continue
      try {
        await this.#options.build()
      } catch (error) {
        this.#fingerprint = candidateFingerprint
        this.#options.onError?.(error, 'build')
        continue
      }
      this.#fingerprint = await fingerprint(this.#options.watchPaths)
      if (this.#stopping) return
      const previous = this.#target
      try {
        await previous?.stop()
        this.#target = undefined
        if (this.#stopping) return
        this.#target = await this.#options.start()
        this.#options.onReloaded?.()
      } catch (error) {
        this.#options.onError?.(error, 'replace')
      }
    }
  }
}

async function fingerprint(watchPaths: readonly string[]): Promise<string> {
  const entries: string[] = []
  for (const watchPath of [...watchPaths].sort()) await fingerprintEntry(watchPath, watchPath, entries)
  return createHash('sha256').update(entries.join('\n')).digest('hex')
}

async function fingerprintEntry(root: string, entryPath: string, entries: string[]): Promise<void> {
  const metadata = await stat(entryPath)
  const relative = path.relative(root, entryPath).split(path.sep).join('/') || '.'
  if (!metadata.isDirectory()) {
    entries.push(`${root}:${relative}:${metadata.size}:${metadata.mtimeMs}`)
    return
  }
  const children = await readdir(entryPath, { withFileTypes: true })
  for (const child of children.sort((left, right) => left.name.localeCompare(right.name))) {
    await fingerprintEntry(root, path.join(entryPath, child.name), entries)
  }
}
