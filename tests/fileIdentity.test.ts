import { describe, expect, it } from 'vitest'
import { fileFingerprint } from '../src/data/fileIdentity'
import { visibleWorkspaces } from '../src/data/workspaceStore'
import type { WorkspaceSummary } from '../src/data/workspaceStore'

describe('uploaded file identity', () => {
  it('matches identical bytes regardless of names and timestamps, but distinguishes changed data and parsing formats', async () => {
    const text = 'Team,Amount\nWest,10\nEast,20'
    const original = await fileFingerprint(new File([text], 'sales.csv', { lastModified: 1 }))
    expect(await fileFingerprint(new File([text], 'a-copy.CSV', { lastModified: 20 }))).toBe(original)
    expect(await fileFingerprint(new File([text.replace('10', '30')], 'sales.csv', { lastModified: 1 }))).not.toBe(original)
    expect(await fileFingerprint(new File([text], 'sales.tsv'))).not.toBe(original)
  })

  it('prefers the newest completed analysis and retains distinct files with the same display name', () => {
    const summary: WorkspaceSummary = { id: 'old', fingerprint: 'csv:one', title: 'sales', filename: 'sales.csv', rows: 2,
      hasDashboard: true, hasDraft: false, updated: 1 }
    const files = [summary, { ...summary, id: 'new', updated: 3 },
      { ...summary, id: 'changed', fingerprint: 'csv:two', updated: 2 },
      { ...summary, id: 'unfinished-duplicate', hasDashboard: false, updated: 4 }]
    expect(visibleWorkspaces(files).map(file => file.id)).toEqual(['new', 'changed'])
    expect(files).toHaveLength(4)
  })
})
