import { readSource } from './import'
import { profile } from './infer'

self.onmessage = async (event: MessageEvent<{ file: File; sheet?: string }>) => {
  try {
    const source = await readSource(event.data.file, event.data.sheet)
    self.postMessage({ source, dataset: profile(source) })
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'The file could not be read.' })
  }
}
