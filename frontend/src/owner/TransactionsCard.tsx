import { useEffect, useState } from 'react'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Chip from '@mui/material/Chip'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'
import { api, type CreditTransaction } from '../api'

const meaning: Record<CreditTransaction['type'], { label: string; color: 'success' | 'warning' | 'error' | 'info' }> = {
  PURCHASE: { label: 'Bought', color: 'success' },
  HOLD: { label: 'Held', color: 'warning' },
  DEDUCT: { label: 'Charged', color: 'error' },
  RELEASE: { label: 'Returned', color: 'info' },
}

/** The bank statement: every credit movement, newest first. Never edited. */
export default function TransactionsCard({ storeId, version }: { storeId: string; version: number }) {
  const [rows, setRows] = useState<CreditTransaction[]>([])

  useEffect(() => {
    api.transactions(storeId).then(setRows, () => setRows([]))
  }, [storeId, version])

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h6">Credit history</Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Type</TableCell>
              <TableCell align="right">Credits</TableCell>
              <TableCell>When</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.slice(0, 15).map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <Chip size="small" variant="outlined" color={meaning[row.type].color} label={meaning[row.type].label} />
                </TableCell>
                <TableCell align="right">{row.amount.toLocaleString('en-IN')}</TableCell>
                <TableCell>{new Date(row.createdAt).toLocaleString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {rows.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            No credit movements yet.
          </Typography>
        )}
      </CardContent>
    </Card>
  )
}
