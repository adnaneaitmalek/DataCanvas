import { Boxes, ChevronDown, FileSpreadsheet, Globe2, MessageSquareText, ReceiptText, ShoppingBag } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { ComponentProps, ReactNode } from 'react'
import { samples } from '../data/samples'
import type { SampleId } from '../data/samples'

const sampleIcons = { sales: ShoppingBag, expenses: ReceiptText, traffic: Globe2, inventory: Boxes, surveys: MessageSquareText }

export function Brand() {
  return <a className="brand" href="#/" aria-label="DataCanvas home">
    <img className="brand-mark" src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width={34} height={34} />
    <span>DataCanvas</span>
  </a>
}

export function WorkspaceLink({ route, onFollow, children }: {
  route: 'review' | 'dashboard'; onFollow: () => void; children: ReactNode
}) {
  return <a className="button secondary" href={`#/${route}`} onClick={event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    onFollow()
  }}>{children}</a>
}

export function Select({ children, className = '', ...props }: ComponentProps<'select'>) {
  return <span className={`select-wrap ${className}`}><select {...props}>{children}</select><ChevronDown size={14} aria-hidden="true" /></span>
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>
}

export function closePopover(details: HTMLDetailsElement | null) {
  if (!details) return
  details.open = false
  details.querySelector('summary')?.focus()
}

export function Popover({ label, className, buttonClass, children }: {
  label: ReactNode; className: string; buttonClass: string; children: ReactNode
}) {
  const ref = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && ref.current?.open && !ref.current.contains(event.target)) ref.current.open = false
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [])
  return <details ref={ref} className={className} onKeyDown={event => {
    if (event.key === 'Escape' && event.currentTarget.open) {
      event.preventDefault()
      closePopover(event.currentTarget)
    }
  }} onBlur={event => {
    if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false
  }}><summary className={buttonClass}>{label}</summary>{children}</details>
}

export function SampleGrid({ onSample }: { onSample: (id: SampleId) => void }) {
  return <div className="sample-grid">
    {samples.map(sample => {
      const Icon = sampleIcons[sample.id]
      return <button type="button" className="sample-card" key={sample.id} onClick={() => onSample(sample.id)}>
        <span className="sample-icon"><Icon size={19} aria-hidden="true" /></span>
        <span className="sample-copy"><strong>{sample.title}</strong><span>{sample.description}</span></span>
        <span className="sample-rows">{sample.rows} rows</span>
      </button>
    })}
  </div>
}

export function FileIdentity({ name, detail }: { name: string; detail: string }) {
  return <div className="file-identity">
    <span className="file-icon"><FileSpreadsheet size={21} aria-hidden="true" /></span>
    <div><strong title={name}>{name}</strong><span>{detail}</span></div>
  </div>
}
