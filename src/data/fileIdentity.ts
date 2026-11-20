/** Compare file bytes and parsing format, independently of names and modification dates. */
export async function fileFingerprint(file: File) {
  const bytes = await file.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  return `${file.name.split('.').at(-1)?.toLowerCase()}:${hash}`
}
