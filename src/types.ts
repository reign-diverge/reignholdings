export const SOURCES = ['Furniture', 'Carpets', 'Upholstery'] as const
export const BUCKETS = ['Savings', 'Expenses', 'Restocking'] as const

export type Source = (typeof SOURCES)[number]
export type Bucket = (typeof BUCKETS)[number]

export interface Sale {
  id: string
  user_id: string
  source: Source
  amount: number
  sold_on: string
  note: string
}

export interface Spending {
  id: string
  user_id: string
  bucket: Bucket
  amount: number
  spent_on: string
  note: string
}

export interface StockItem {
  id: string
  user_id: string
  source: Source
  item: string
  quantity: number
  value_each: number
  added_on: string
  note: string
}

export interface LedgerSettings {
  user_id: string
  savings_goal: number
  savings_percent: number
  expenses_percent: number
  restocking_percent: number
}
