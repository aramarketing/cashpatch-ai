'use client'
import { useRef,useState } from 'react'
export default function CsvImport(){
  const ref=useRef<HTMLInputElement>(null); const [state,setState]=useState('')
  return <div className="csv-import"><input ref={ref} type="file" accept=".csv,text/csv" hidden onChange={async e=>{
    const file=e.target.files?.[0]; if(!file)return; setState('Scanning…')
    const fd=new FormData(); fd.append('file',file)
    const res=await fetch('/api/import/csv',{method:'POST',body:fd}); const data=await res.json()
    if(!res.ok){setState(data.error||'Import failed');return}
    setState(`${data.findings} findings · €${Math.round(data.totalPotential).toLocaleString('en-GB')} potential`); setTimeout(()=>location.reload(),700)
  }}/><button onClick={()=>ref.current?.click()}>Import CSV & scan</button>{state&&<span>{state}</span>}</div>
}
