export type ImagePage = { jpeg: Uint8Array; width: number; height: number }

// Landscape PDF pages with one embedded JPEG per page and a standard byte-offset table.
export function imagePdf(pages: ImagePage[]): Blob {
  const encoder = new TextEncoder()
  const parts: Uint8Array<ArrayBuffer>[] = []
  const offsets = [0]
  let length = 0
  const push = (data: string | Uint8Array<ArrayBuffer>) => {
    const bytes = typeof data === 'string' ? encoder.encode(data) : data
    parts.push(bytes)
    length += bytes.byteLength
  }
  const object = (id: number, body: string, stream?: Uint8Array<ArrayBuffer>) => {
    offsets[id] = length
    push(`${id} 0 obj\n${body}\n`)
    if (stream) { push('stream\n'); push(stream); push('\nendstream\n') }
    push('endobj\n')
  }

  push('%PDF-1.4\n')
  object(1, '<< /Type /Catalog /Pages 2 0 R >>')
  object(2, `<< /Type /Pages /Kids [${pages.map((_, index) => `${3 + index * 3} 0 R`).join(' ')}] /Count ${pages.length} >>`)
  for (const [index, { jpeg, width, height }] of pages.entries()) {
    const id = 3 + index * 3
    const scale = Math.min(806 / width, 559 / height)
    const w = width * scale
    const h = height * scale
    const commands = encoder.encode(`q\n${w.toFixed(3)} 0 0 ${h.toFixed(3)} ${((842 - w) / 2).toFixed(3)} ${((595 - h) / 2).toFixed(3)} cm\n/Dashboard Do\nQ\n`)
    object(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /XObject << /Dashboard ${id + 1} 0 R >> >> /Contents ${id + 2} 0 R >>`)
    object(id + 1, `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.byteLength} >>`, new Uint8Array(jpeg))
    object(id + 2, `<< /Length ${commands.byteLength} >>`, commands)
  }
  const xref = length
  push(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`)
  for (const offset of offsets.slice(1)) push(`${String(offset).padStart(10, '0')} 00000 n \n`)
  push(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
  return new Blob(parts, { type: 'application/pdf' })
}
