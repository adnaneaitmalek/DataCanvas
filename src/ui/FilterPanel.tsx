import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { ListFilter, Plus, X } from 'lucide-react'
import { columnLabel } from '../data/currency'
import { FilterInputError, filterDescription, filterInput, initialDraft, numberExample, operatorsFor, parseFilter } from '../data/filters'
import type { Filter, FilterDraft, MatchMode, Operator } from '../data/filters'
import { isMeasure } from '../data/model'
import type { Dataset } from '../data/model'
import { Field, Select } from './shared'

export function FilterButton({ open, count, controls, onClick }: {
  open: boolean; count: number; controls: string; onClick: () => void
}) {
  return <button type="button" className="button secondary filters-toggle" aria-expanded={open} aria-haspopup="dialog"
    aria-controls={open ? controls : undefined} onClick={onClick}>
    <ListFilter size={16} /> Filters {count > 0 && <span className="filter-count">{count}</span>}
  </button>
}

export function FilterPanel({ dataset, filters, mode, onChange, onMode, open, onOpen, onViewResults, id, anchor, hasMatches }: {
  dataset: Dataset; filters: Filter[]; mode: MatchMode; onChange: (filters: Filter[]) => void; onMode: (mode: MatchMode) => void;
  open: boolean; onOpen: (open: boolean) => void; onViewResults: () => void; id: string
  anchor: HTMLDivElement | null; hasMatches: boolean
}) {
  const first = dataset.columns.find(column => column.kind === 'category') ?? dataset.columns[0]
  const [draft, setDraft] = useState<FilterDraft>(() => initialDraft(first))
  const [editing, setEditing] = useState<number>()
  const [error, setError] = useState<{ message: string; field: 'value' | 'end' | 'column' }>()
  const columnInput = useRef<HTMLSelectElement>(null)
  const resultsButton = useRef<HTMLButtonElement>(null)
  const editor = useRef<HTMLDialogElement>(null)
  const applied = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const hint = useId()
  const errorId = useId()
  const column = dataset.columns[draft.column]
  const dated = column.kind === 'date'
  const numeric = isMeasure(column.kind)
  const bounds = draft.operator === 'between'
  const hasInput = draft.operator !== 'missing' && draft.operator !== 'present'
  const choices = useMemo(() => {
    if (column.kind !== 'category') return undefined
    const options = new Set<string>()
    for (const row of dataset.rows) {
      if (row[column.index] !== null) options.add(String(row[column.index]))
      if (options.size > 100) return undefined
    }
    return [...options].sort((a, b) => a.localeCompare(b))
  }, [dataset.rows, column])

  useEffect(() => {
    const dialog = editor.current
    if (!open || !anchor || !dialog) return
    const narrow = window.matchMedia('(max-width: 700px)')
    function show() {
      if (!dialog) return
      if (dialog.open) dialog.close()
      if (narrow.matches) dialog.showModal()
      else dialog.show()
      columnInput.current?.focus({ preventScroll: true })
    }
    function dismissOutside(event: PointerEvent) {
      if (!narrow.matches && event.target instanceof Node && !anchor?.contains(event.target) && !applied.current?.contains(event.target)) onOpen(false)
    }
    show()
    narrow.addEventListener('change', show)
    document.addEventListener('pointerdown', dismissOutside)
    return () => {
      narrow.removeEventListener('change', show)
      document.removeEventListener('pointerdown', dismissOutside)
      if (dialog.open) dialog.close()
    }
  }, [anchor, onOpen, open])

  function focusTrigger() {
    anchor?.querySelector<HTMLButtonElement>('.filters-toggle')?.focus({ preventScroll: true })
  }

  function dismiss() {
    reset(initialDraft(first))
    onOpen(false)
    requestAnimationFrame(focusTrigger)
  }

  function update(next: FilterDraft) {
    setError(undefined)
    setDraft(next)
  }

  function edit(filter: Filter, index: number) {
    setEditing(index)
    const field = dataset.columns[filter.column]
    update({ column: filter.column, operator: filter.operator, value: filterInput(filter.value, field), end: filterInput(filter.end, field) })
    if (open) columnInput.current?.focus()
    else onOpen(true)
  }

  function reset(next = initialDraft(column)) {
    setEditing(undefined)
    update(next)
  }

  function remove(index: number) {
    onChange(filters.filter((_, i) => index !== i))
    if (editing === index) reset()
    else if (editing !== undefined && index < editing) setEditing(editing - 1)
    if (open) columnInput.current?.focus()
    else focusTrigger()
  }

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try {
      const filter = parseFilter(draft, column)
      onChange(editing === undefined ? [...filters, filter] : filters.map((previous, index) => editing === index ? filter : previous))
      reset({ ...draft, value: '', end: '' })
      requestAnimationFrame(() => resultsButton.current?.focus())
    } catch (problem) {
      const field = problem instanceof FilterInputError ? problem.field : 'column'
      setError({ field, message: problem instanceof Error ? problem.message : 'Check this condition and try again.' })
      event.currentTarget.querySelector<HTMLElement>(`[data-filter-field="${field}"]`)?.focus()
    }
  }

  const invalid = (field: NonNullable<typeof error>['field']) => ({
    'data-filter-field': field,
    'aria-invalid': error?.field === field || undefined,
    'aria-describedby': error?.field === field ? errorId : undefined,
  })
  const reportError = (field: NonNullable<typeof error>['field']) => error?.field === field
    ? <p className="field-error" id={errorId} role="alert">{error.message}</p>
    : null

  const combine = filters.length > 1 && <Field label="Combine conditions">
    <Select value={mode} onChange={event => onMode(event.target.value as MatchMode)}>
      <option value="all">Match all (AND)</option><option value="any">Match any (OR)</option>
    </Select>
  </Field>

  return <div ref={applied} className={`filters-area${filters.length ? ' has-content' : ''}`}>
    {filters.length > 0 && <div className="filter-chips" aria-label="Applied filters">
      {!open && combine}
      {filters.map((filter, i) => {
        const field = dataset.columns[filter.column]
        const description = filterDescription(filter, field)
        const label = columnLabel(field)
        return <span className="filter-chip" key={i}>
          <button type="button" onClick={() => edit(filter, i)} aria-label={`Edit filter ${label} ${description}`}>
            <strong>{label}</strong> {description}
          </button>
          <button type="button" className="filter-remove" onClick={() => remove(i)} aria-label={`Remove filter ${label} ${description}`}><X size={14} /></button>
        </span>
      })}
      {hasMatches && <button className="quiet-link" type="button" onClick={() => {
        onChange([]); reset(initialDraft(first)); onMode('all')
        if (open) columnInput.current?.focus()
        else focusTrigger()
      }}>Clear filters</button>}
    </div>}
    {open && anchor && createPortal(<dialog ref={editor} id={id} className="filter-surface" aria-labelledby={titleId}
      onCancel={event => { event.preventDefault(); dismiss() }}
      onClick={event => { if (event.target === event.currentTarget) dismiss() }}
      onKeyDown={event => {
        if (event.key !== 'Escape' || event.defaultPrevented || event.currentTarget.matches(':modal')) return
        if (CSS.supports('selector(:open)') && event.currentTarget.querySelector('select:open')) return
        event.preventDefault()
        dismiss()
      }}>
    <form className="filter-editor" onSubmit={apply} noValidate>
      <div className="filter-editor-heading">
        <div><h2 id={titleId}>{editing === undefined ? 'Add a condition' : 'Edit condition'}</h2>
          <p id={hint}>Conditions apply to the entire dashboard.</p></div>
        <button type="button" className="button text-button icon-button" aria-label="Close filters" onClick={dismiss}><X size={17} /></button>
      </div>
      <div className="filter-fields" aria-describedby={hint}>
        <div><Field label="Filter column"><Select {...invalid('column')} ref={columnInput} value={draft.column} onChange={event => update(initialDraft(dataset.columns[Number(event.target.value)]))}>
          {dataset.columns.map(item => <option key={item.index} value={item.index}>{columnLabel(item)}</option>)}
        </Select></Field>{reportError('column')}</div>
        <Field label="Operator"><Select value={draft.operator} onChange={event => update({ ...draft, operator: event.target.value as Operator, end: '' })}>
          {operatorsFor(column.kind).map(([value, name]) => <option key={value} value={value}>{name}</option>)}
        </Select></Field>
        {hasInput && <div><Field label={bounds ? (dated ? 'From date' : 'Minimum') : dated ? 'Date' : 'Value'}>
          {choices ? <Select value={draft.value} {...invalid('value')}
            onChange={event => update({ ...draft, value: event.target.value })}>
            <option value="">Choose a value</option>{choices.map(option => <option key={option} value={option}>{option}</option>)}
          </Select> : <input type={dated ? 'date' : 'text'} inputMode={numeric ? 'decimal' : undefined} value={draft.value}
            placeholder={numeric ? column.numberStyle === 'comma' ? '1,25' : '1.25' : undefined}
            {...invalid('value')} onChange={event => update({ ...draft, value: event.target.value })} />}
        </Field>{reportError('value')}</div>}
        {bounds && <div><Field label={dated ? 'To date' : 'Maximum'}>
          <input type={dated ? 'date' : 'text'} inputMode={numeric ? 'decimal' : undefined} value={draft.end}
            {...invalid('end')} onChange={event => update({ ...draft, end: event.target.value })} />
        </Field>{reportError('end')}</div>}
      </div>
      {combine && <div className="filter-combine">{combine}</div>}
      <div className="filter-editor-footer">
        {!error && numeric && hasInput && <p className="filter-format-hint">{numberExample(column)}</p>}
        <div>
          {editing !== undefined && <button className="button text-button" type="button" onClick={() => { reset(); columnInput.current?.focus() }}>Cancel edit</button>}
          <button className="button primary" type="submit">{editing === undefined && <Plus size={15} />}
            {editing === undefined ? 'Apply filter' : 'Save filter'}</button>
          {!!filters.length && <button ref={resultsButton} className="button secondary" type="button" onClick={onViewResults}>View results</button>}
        </div>
      </div>
    </form></dialog>, anchor)}
  </div>
}
