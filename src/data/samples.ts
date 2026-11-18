import { profile } from './infer'
import type { Cell, Source } from './model'

export type SampleId = 'sales' | 'expenses' | 'traffic' | 'inventory' | 'surveys'

export const samples = [
  { id: 'sales', title: 'Retail sales', filename: 'retail-sales.csv', description: 'Orders, revenue, and units sold across four regions.', rows: 480 },
  { id: 'expenses', title: 'Team expenses', filename: 'team-expenses.csv', description: 'Reimbursements by team, month, and expense category.', rows: 168 },
  { id: 'traffic', title: 'Website traffic', filename: 'website-traffic.csv', description: 'Daily sessions and engagement by acquisition channel.', rows: 420 },
  { id: 'inventory', title: 'Warehouse inventory', filename: 'warehouse-inventory.csv', description: 'Stock levels and unit costs across two warehouses.', rows: 96 },
  { id: 'surveys', title: 'Customer survey', filename: 'customer-survey.csv', description: 'Satisfaction scores and feedback by customer segment.', rows: 240 },
] as const

function randomizer(initial: number) {
  let seed = initial
  return () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0
    return seed / 0x100000000
  }
}

const day = (offset: number) => new Date(Date.UTC(2025, 0, 1 + offset)).toISOString().slice(0, 10)
const cents = (value: number) => Math.round(value * 100) / 100

const headers: Record<SampleId, string[]> = {
  sales: ['Order ID', 'Order date', 'Region', 'Product line', 'Revenue (USD)', 'Units sold', 'Sales channel'],
  expenses: ['Expense ID', 'Expense date', 'Team', 'Category', 'Amount (USD)', 'Payment method', 'Receipt status'],
  traffic: ['Date', 'Channel', 'Sessions', 'Conversions', 'Bounce rate (%)'],
  inventory: ['SKU', 'Item', 'Category', 'Warehouse', 'Units on hand', 'Reorder point', 'Unit cost (USD)'],
  surveys: ['Response ID', 'Segment', 'Satisfaction score', 'Would recommend', 'Feedback'],
}

export function loadSample(id: SampleId) {
  const sampleIndex = samples.findIndex(sample => sample.id === id)
  const sample = samples[sampleIndex]
  const random = randomizer(7841 + sampleIndex * 129)
  const pick = <const T,>(options: readonly T[]) => options[Math.floor(random() * options.length)]
  const rows = Array.from({ length: sample.rows }, (_, i): Cell[] => {
    if (id === 'sales') {
      const products = [
        { label: 'Office', price: 42 }, { label: 'Kitchen', price: 64 },
        { label: 'Outdoor', price: 83 }, { label: 'Lighting', price: 115 },
      ]
      const product = pick(products)
      const time = Math.floor(i / sample.rows * 181)
      const regions = ['West', 'West', 'West', 'North', 'North', 'South', 'East']
      const baseUnits = [2.3, 3.1, 2.6, 4.2, 3.8, 5.3][Math.floor(time / 31)]
      const units = Math.max(1, Math.round(baseUnits + random() * 5 - 1.5))
      const region = pick(regions)
      const price = product.price * (0.83 + random() * 0.36)
      return [`ORD-${10001 + i}`, day(time), region, product.label, cents(price * units), units, pick(['Online', 'Retail', 'Retail', 'Wholesale'])]
    }
    if (id === 'expenses') {
      const category = pick(['Travel', 'Software', 'Meals', 'Office supplies', 'Training'])
      const bases = { Travel: 375, Software: 130, Meals: 48, 'Office supplies': 72, Training: 260 }
      return [`EXP-${4001 + i}`, day(Math.floor(i / sample.rows * 122)), pick(['Operations', 'Product', 'Sales', 'Design']), category,
        cents(bases[category] * (0.4 + random() * 2.3)), pick(['Card', 'Reimbursement']), i % 17 ? 'Attached' : 'Pending']
    }
    if (id === 'traffic') {
      const channel = i % 5
      const time = Math.floor(i / 5)
      const sessions = Math.round([820, 515, 302, 192, 114][channel] * (0.58 + time / 125 + random() * 0.6) * (time % 7 > 4 ? 0.73 : 1))
      return [day(time), ['Organic search', 'Direct', 'Paid search', 'Referral', 'Email'][channel], sessions,
        Math.round(sessions * (0.012 + random() * 0.046)),
        time === 34 && channel === 2 ? null : cents(35 + channel * 4 + random() * 18)]
    }
    if (id === 'inventory') {
      const products = ['Notebook', 'Desk mat', 'Task lamp', 'Lunch box', 'Water bottle', 'Storage bin', 'Camp mug', 'Wall hook']
      const categories = ['Stationery', 'Office', 'Lighting', 'Kitchen', 'Kitchen', 'Storage', 'Outdoor', 'Storage']
      const product = Math.floor(i / 12)
      const stock = Math.max(0, Math.round(random() * 120 - 8))
      return [`SKU-${String(i + 1).padStart(4, '0')}`, `${products[product]} · ${['Small', 'Medium', 'Large'][i % 3]} / ${['Sand', 'Slate', 'Pine', 'Clay'][i % 4]}`,
        categories[product], i % 4 === 0 ? 'East depot' : 'West depot', stock, 10 + product * 3, cents(4 + product * 3 + random() * 12)]
    }
    const score = Math.min(10, Math.max(1, Math.round(2 + (random() + random()) * 4.5)))
    const feedback = score >= 8 ? ['Setup was straightforward.', 'The weekly reports save me time.', 'Easy to find what I need.']
      : score >= 5 ? ['I would like more export options.', 'The mobile view could use work.', 'It covers the basics.']
        : ['I had trouble getting started.', 'I could not find the settings.']
    return [`RSP-${2001 + i}`, pick(['Small business', 'Independent', 'Enterprise', 'Nonprofit']), i % 29 ? score : null,
      score >= 8 ? 'Yes' : score >= 6 ? 'Maybe' : 'No', i % 3 ? null : pick(feedback)]
  })
  const source: Source = { filename: sample.filename, headers: headers[id], rows, notices: [] }
  return { source, dataset: profile(source), sample: id, title: sample.title }
}
