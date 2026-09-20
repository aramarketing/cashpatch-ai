'use client'
import { useState } from 'react'

type PriceKey = 'standard_monthly'|'standard_yearly'|'pro_monthly'|'pro_yearly'

export function CheckoutButton({ priceKey, children }:{priceKey:PriceKey;children:React.ReactNode}){
  const [loading,setLoading]=useState(false)
  return <button disabled={loading} onClick={async()=>{
    setLoading(true)
    try{
      const response=await fetch('/api/checkout',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({priceKey})})
      const data=await response.json()
      if(!response.ok) throw new Error(data.error||'Checkout failed')
      location.href=data.url
    }catch(error){alert(error instanceof Error?error.message:'Checkout failed');setLoading(false)}
  }}>{loading?'Opening checkout…':children}</button>
}

export function PortalButton(){
  const [loading,setLoading]=useState(false)
  return <button className="ghost" disabled={loading} onClick={async()=>{
    setLoading(true)
    try{
      const response=await fetch('/api/portal',{method:'POST'})
      const data=await response.json()
      if(!response.ok) throw new Error(data.error||'Portal unavailable')
      location.href=data.url
    }catch(error){alert(error instanceof Error?error.message:'Portal unavailable');setLoading(false)}
  }}>{loading?'Opening…':'Manage billing'}</button>
}
