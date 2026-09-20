export type MoneyEventInput = {
  id?: string
  type: 'lead_silent'|'quote_silent'|'invoice_overdue'|'invoice_part_paid'|'vendor_renewal'|'vendor_price_change'
  counterparty: string
  amount?: number
  currency: 'EUR'|'USD'|'GBP'
  daysSilent?: number
  daysOverdue?: number
  paidAmount?: number
  previousAmount?: number
  renewalInDays?: number
  evidence: string[]
}

const allowedTypes = new Set<MoneyEventInput['type']>(['lead_silent','quote_silent','invoice_overdue','invoice_part_paid','vendor_renewal','vendor_price_change'])
const allowedCurrencies = new Set(['EUR','USD','GBP'])

function splitCsvLine(line:string){
  const cells:string[]=[]; let current=''; let quoted=false
  for(let i=0;i<line.length;i++){
    const ch=line[i]
    if(ch==='"'){
      if(quoted && line[i+1]==='"'){current+='"';i++} else quoted=!quoted
    } else if(ch===',' && !quoted){cells.push(current.trim());current=''} else current+=ch
  }
  cells.push(current.trim()); return cells
}

function numberOrUndefined(value?:string){
  if(!value) return undefined
  const normalized=value.replace(/\s/g,'').replace(',','.')
  const n=Number(normalized)
  return Number.isFinite(n)?n:undefined
}

export function parseMoneyLeakCsv(text:string,maxRows=500):MoneyEventInput[]{
  const lines=text.replace(/^\uFEFF/,'').split(/\r?\n/).filter(x=>x.trim())
  if(lines.length<2) throw new Error('CSV must include a header and at least one data row.')
  if(lines.length-1>maxRows) throw new Error(`CSV may contain at most ${maxRows} data rows.`)
  const header=splitCsvLine(lines[0]).map(x=>x.toLowerCase())
  const index=(name:string)=>header.indexOf(name)
  const get=(cells:string[],name:string)=>{const i=index(name);return i>=0?cells[i]?.trim():undefined}
  const rows:MoneyEventInput[]=[]
  for(let r=1;r<lines.length;r++){
    const cells=splitCsvLine(lines[r])
    const rawType=get(cells,'type') as MoneyEventInput['type']|undefined
    const counterparty=get(cells,'counterparty')
    if(!rawType || !allowedTypes.has(rawType)) throw new Error(`Row ${r+1}: unsupported type.`)
    if(!counterparty) throw new Error(`Row ${r+1}: counterparty is required.`)
    const currency=(get(cells,'currency')||'EUR').toUpperCase()
    if(!allowedCurrencies.has(currency)) throw new Error(`Row ${r+1}: unsupported currency.`)
    const amount=numberOrUndefined(get(cells,'amount'))
    if(amount!==undefined && (amount<0 || amount>100000000)) throw new Error(`Row ${r+1}: amount is out of range.`)
    rows.push({
      id:get(cells,'id'), type:rawType, counterparty:counterparty.slice(0,240), amount,
      currency:currency as MoneyEventInput['currency'],
      daysSilent:numberOrUndefined(get(cells,'days_silent')),
      daysOverdue:numberOrUndefined(get(cells,'days_overdue')),
      paidAmount:numberOrUndefined(get(cells,'paid_amount')),
      previousAmount:numberOrUndefined(get(cells,'previous_amount')),
      renewalInDays:numberOrUndefined(get(cells,'renewal_in_days')),
      evidence:(get(cells,'evidence')||'').split('|').map(x=>x.trim()).filter(Bolean).slice(0,20),
    })
  }
  return rows
}
