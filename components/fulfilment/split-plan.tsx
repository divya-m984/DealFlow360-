// OWNER: D2.  The suggested split, with the reasoning printed underneath it.
//
// The reason string comes from lib/allocate.ts, not from this component — the
// engine explains its own decision, so what the screen says can never drift
// from what the code did.
'use client'

import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Money } from '@/components/shared/money'
import { qty } from '@/components/billing/format'

export type Plan = {
  allocations: { warehouseId: number; warehouseCode?: string; warehouseName?: string; qty: number; shippingCost: number }[]
  backorderQty: number
  shipments: number
  totalShippingCost: number
  strategy: 'single_warehouse' | 'min_shipments' | 'greedy_fallback' | 'backorder_only'
  reason: string
}

const STRATEGY_LABEL: Record<Plan['strategy'], string> = {
  single_warehouse: 'One warehouse',
  min_shipments: 'Fewest shipments',
  greedy_fallback: 'Greedy fallback',
  backorder_only: 'Backorder',
}

export function SplitPlan({ plan, currency }: { plan: Plan; currency?: string }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={plan.strategy === 'backorder_only' ? 'destructive' : 'secondary'}>
          {STRATEGY_LABEL[plan.strategy]}
        </Badge>
        <span className="text-sm text-muted-foreground">
          {plan.shipments} shipment{plan.shipments === 1 ? '' : 's'} · shipping <Money value={plan.totalShippingCost} currency={currency} />
        </span>
      </div>

      {plan.allocations.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Warehouse</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Shipping</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {plan.allocations.map((a) => (
              <TableRow key={a.warehouseId}>
                <TableCell>{a.warehouseName ?? a.warehouseCode ?? a.warehouseId}</TableCell>
                <TableCell className="text-right tabular-nums">{qty(a.qty)}</TableCell>
                <TableCell className="text-right"><Money value={a.shippingCost} currency={currency} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {plan.backorderQty > 0 && (
        <p className="text-sm text-destructive">{qty(plan.backorderQty)} units would go on backorder.</p>
      )}

      <p className="text-xs text-muted-foreground">{plan.reason}</p>
    </div>
  )
}
