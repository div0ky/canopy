import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { HotReloadSupervisor } from '@doxajs/praxis/hot-reload'
import { afterEach, describe, expect, it } from 'vitest'

const directories: string[] = []

describe('Doxa hot reload', () => {
  afterEach(async () => {
    await Promise.all(
      directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
    )
  })

  it('keeps the last good target alive after a failed build and replaces it after recovery', async () => {
    const directory = await temporaryDirectory()
    let buildShouldFail = false
    let builds = 0
    let starts = 0
    const stopped: number[] = []
    const errors: Array<{ error: unknown; phase: string }> = []
    const supervisor = await HotReloadSupervisor.start({
      watchPaths: [directory],
      build: () => {
        builds += 1
        if (buildShouldFail) throw new Error('invalid edit')
      },
      start: () => {
        const id = ++starts
        return {
          stop: () => {
            stopped.push(id)
          },
        }
      },
      onError: (error, phase) => errors.push({ error, phase }),
    })

    try {
      buildShouldFail = true
      await supervisor.requestReload()
      expect({ builds, starts, stopped }).toEqual({ builds: 2, starts: 1, stopped: [] })
      expect(errors).toHaveLength(1)
      expect(errors[0]?.phase).toBe('build')

      buildShouldFail = false
      await supervisor.requestReload()
      expect({ builds, starts, stopped }).toEqual({ builds: 3, starts: 2, stopped: [1] })
    } finally {
      await supervisor.stop()
    }
    expect(stopped).toEqual([1, 2])
  })

  it('debounces filesystem changes and reloads without manual intervention', async () => {
    const directory = await temporaryDirectory()
    let starts = 0
    let resolveReload!: () => void
    const reloaded = new Promise<void>((resolve) => {
      resolveReload = resolve
    })
    const supervisor = await HotReloadSupervisor.start({
      watchPaths: [directory],
      debounceMilliseconds: 20,
      build: () => undefined,
      start: () => ({ stop: () => undefined }),
      onReloaded: () => {
        starts += 1
        resolveReload()
      },
    })

    try {
      await writeFile(path.join(directory, 'route.ts'), 'export class Route {}\n')
      await Promise.race([
        reloaded,
        new Promise<never>((_resolve, reject) =>
          setTimeout(() => reject(new Error('watch timed out')), 2_000),
        ),
      ])
      expect(starts).toBe(1)
    } finally {
      await supervisor.stop()
    }
  })
})

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'doxa-hot-reload-'))
  directories.push(directory)
  return directory
}
