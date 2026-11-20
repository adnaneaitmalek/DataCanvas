import { readSource } from './import'
import { profile } from './infer'
import type { Dataset, Delimiter, Edits, Settings, Source } from './model'

export type WorkRequest = { kind: 'import'; file: File; sheet?: string; delimiter?: Delimiter; edits: Edits; settings: Settings } |
  { kind: 'profile'; source: Source; edits: Edits; settings: Settings }
export type WorkResult = { error: string } | { progress: string } | { source?: Source; dataset: Dataset }

self.onmessage = async (event: MessageEvent<WorkRequest>) => {
  try {
    const job = event.data
    if (job.kind === 'profile') {
      self.postMessage({ dataset: profile(job.source, job.edits, job.settings) } satisfies WorkResult)
    } else {
      const source = await readSource(job.file, job.sheet, job.delimiter)
      self.postMessage({ progress: 'Checking columns' } satisfies WorkResult)
      self.postMessage({ source, dataset: profile(source, job.edits, job.settings) } satisfies WorkResult)
    }
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'The file could not be read.' })
  }
}
