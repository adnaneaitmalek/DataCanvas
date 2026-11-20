import { useCallback, useEffect, useRef, useState } from 'react'
import { deleteWorkspace, listWorkspaces, readWorkspace, summarizeWorkspace, visibleWorkspaces, writeWorkspace } from '../data/workspaceStore'
import type { Workspace, WorkspaceSummary } from '../data/workspaceStore'

export function useWorkspaces() {
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([])
  const [storageError, setStorageError] = useState('')
  const pending = useRef(new Map<string, Workspace>())
  const queue = useRef<Promise<void>>(Promise.resolve())
  const unsavedContent = useRef(new Set<string>())
  const unsavedWorkspaces = useRef(new Set<string>())
  const removing = useRef(new Set<string>())

  useEffect(() => {
    let active = true
    listWorkspaces().then(saved => {
      if (!active) return
      setWorkspaces(current => visibleWorkspaces([...current, ...saved.filter(item => !current.some(previous => previous.id === item.id))]))
    }).catch(() => {
      if (active) setStorageError('Browser storage is unavailable. Keep this tab open to return to your work.')
    })
    return () => { active = false }
  }, [])

  const save = useCallback((workspace: Workspace, includeContent: boolean) => {
    if (removing.current.has(workspace.id)) return
    const summary = summarizeWorkspace(workspace)
    pending.current.set(workspace.id, workspace)
    setWorkspaces(current => visibleWorkspaces([summary, ...current.filter(item => item.id !== summary.id)]))
    queue.current = queue.current.then(async () => {
      const writeContent = includeContent || unsavedContent.current.has(summary.id)
      try {
        await writeWorkspace(workspace, summary, writeContent)
        unsavedContent.current.delete(summary.id)
        unsavedWorkspaces.current.delete(summary.id)
        if (pending.current.get(summary.id) === workspace) pending.current.delete(summary.id)
        if (!unsavedWorkspaces.current.size) setStorageError('')
      } catch {
        unsavedWorkspaces.current.add(summary.id)
        if (writeContent) unsavedContent.current.add(summary.id)
        setStorageError('Some changes could not be saved in this browser. Keep this tab open to return to your work.')
      }
    })
  }, [])

  const read = useCallback(async (id: string) => {
    if (removing.current.has(id)) await queue.current
    return pending.current.get(id) ?? await readWorkspace(id)
  }, [])

  const findFile = useCallback(async (fingerprint: string) => {
    // Refresh the index so a reload or an upload in another tab cannot create another listing.
    const stored = await listWorkspaces().catch(() => [])
    return visibleWorkspaces([...workspaces, ...stored]).find(workspace =>
      workspace.fingerprint === fingerprint && !removing.current.has(workspace.id))
  }, [workspaces])

  const remove = useCallback((id: string) => {
    if (removing.current.has(id)) return
    removing.current.add(id)
    queue.current = queue.current.then(async () => {
      try {
        const removed = new Set([id, ...await deleteWorkspace(id)])
        for (const workspaceId of removed) {
          pending.current.delete(workspaceId)
          unsavedContent.current.delete(workspaceId)
          unsavedWorkspaces.current.delete(workspaceId)
        }
        setWorkspaces(current => current.filter(item => !removed.has(item.id)))
      } catch {
        setStorageError('This workspace could not be removed from browser storage.')
      } finally {
        removing.current.delete(id)
      }
    })
  }, [])

  return { workspaces, storageError, save, read, findFile, remove }
}
