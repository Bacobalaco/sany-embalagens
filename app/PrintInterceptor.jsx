'use client';

import { useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
);

const moneyNumber = (v) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const methodLabel = (v) => ({ credit:'CONTA', pix:'PIX', cash:'DINHEIRO', card:'CARTÃO', check:'CHEQUE', transfer:'TRANSFERÊNCIA', other:'OUTRO' }[v] || 'OUTRO');
function escapeText(value) { return String(value ?? '').replace(/[&<>\"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '\"':'&quot;', "'":'&#039;' }[char])); }
function localDateValue() { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }

function buildReceipt({ customer, rows }) {
  document.getElementById('sany-inline-print-receipt')?.remove();
  const purchases=rows.filter((x)=>x.type==='sale'); const payments=rows.filter((x)=>['payment','credit'].includes(x.type));
  const totalPurchases=purchases.reduce((sum,x)=>sum+Number(x.amount||0),0); const totalPayments=payments.reduce((sum,x)=>sum+Number(x.amount||0),0); const balance=totalPurchases-totalPayments;
  const byMethod=Array.from(payments.reduce((map,x)=>{const key=x.payment_method||'other';map.set(key,(map.get(key)||0)+Number(x.amount||0));return map},new Map()).entries());
  const today=new Date().toLocaleDateString('pt-BR');
  const purchaseRows=purchases.map((x)=>`<div class="receipt-row data-row"><span>${escapeText((x.description||'COMPRA').toUpperCase())}</span><span>R$</span><strong>${moneyNumber(x.amount)}</strong></div>`).join('');
  const blankRows=Array.from({length:Math.max(0,8-purchases.length)},()=>`<div class="receipt-row blank-row"><span></span><span></span><span></span></div>`).join('');
  const paymentRows=byMethod.map(([method,amount])=>`<div class="payment-row"><strong>${escapeText(methodLabel(method))}</strong><span>R$</span><strong>${moneyNumber(amount)}</strong></div>`).join('');
  const receipt=document.createElement('section'); receipt.id='sany-inline-print-receipt'; receipt.className='inline-print-receipt';
  receipt.innerHTML=`<div class="receipt-date">${today}</div><div class="receipt-title">${escapeText(customer?.name||'CLIENTE')}</div><div class="receipt-section purchase-section"><div class="receipt-row receipt-head"><strong>DEVE</strong><span>R$</span><strong>VALOR</strong></div>${purchaseRows}${blankRows}<div class="receipt-total"><span>R$</span><strong>${moneyNumber(totalPurchases)}</strong></div></div><div class="receipt-summary"><div class="summary-row paid-row"><strong>PAGOU</strong><strong>${moneyNumber(totalPayments)}</strong></div><div class="summary-row balance-row"><strong>${balance<0?'CRÉDITO':'DEVE'}</strong><span><b>R$</b><strong>${moneyNumber(Math.abs(balance))}</strong></span></div></div><div class="payment-section">${paymentRows||'<div class="payment-row"><strong></strong><span>R$</span><strong>0,00</strong></div>'}<div class="payment-total"><span>R$</span><strong>${moneyNumber(totalPayments)}</strong></div></div><div class="receipt-footer">SANY EMBALAGENS</div>`;
  document.body.appendChild(receipt);
}

export default function PrintInterceptor() {
  useEffect(()=>{
    if(typeof window==='undefined') return undefined;
    let pendingCustomerId=''; let pendingLaunch=null; const originalPrint=window.print.bind(window); let printing=false;
    const captureCustomer=()=>{const customerSelect=Array.from(document.querySelectorAll('select')).find((select)=>{const optionsText=Array.from(select.options).map((option)=>option.textContent||'').join(' | ').toLowerCase();return optionsText.includes('selecione o cliente')&&select.value;});if(customerSelect?.value)pendingCustomerId=customerSelect.value;};
    const ensureLaunchDateField=()=>{
      const customerSelect=Array.from(document.querySelectorAll('select')).find((select)=>{const optionsText=Array.from(select.options).map((option)=>option.textContent||'').join(' | ').toLowerCase();return optionsText.includes('selecione');});
      const form=customerSelect?.closest('form'); if(!form||form.querySelector('[data-sany-launch-date]'))return;
      const paymentInput=Array.from(form.querySelectorAll('input')).find((input)=>(input.closest('label')?.textContent||'').toLowerCase().includes('pagamento agora')); if(!paymentInput)return;
      const label=document.createElement('label'); label.dataset.sanyLaunchDate='true'; label.innerHTML='Data do lançamento<input type="date" data-sany-launch-date />'; paymentInput.closest('label')?.insertAdjacentElement('afterend',label); const input=label.querySelector('input'); if(input)input.value=localDateValue();
    };
    const captureLaunch=(event)=>{
      const form=event.target; if(!(form instanceof HTMLFormElement))return;
      const customerSelect=Array.from(form.querySelectorAll('select')).find((select)=>Array.from(select.options).map((o)=>o.textContent||'').join(' | ').toLowerCase().includes('selecione')); const dateInput=form.querySelector('[data-sany-launch-date]');
      if(!customerSelect||!dateInput||!customerSelect.value||!dateInput.value)return;
      const numberInputs=Array.from(form.querySelectorAll('input[type="number"]')); const purchase=Number(numberInputs[0]?.value||0); const paid=Number(numberInputs[1]?.value||0); if(!purchase)return;
      pendingLaunch={customerId:customerSelect.value,date:dateInput.value,purchase,paid};
      setTimeout(async()=>{
        const launch=pendingLaunch; pendingLaunch=null; if(!launch||launch.date===localDateValue())return;
        const {data:rows,error}=await supabase.from('customer_transactions').select('id,type,amount,transaction_date,description,status').eq('customer_id',launch.customerId).eq('status','posted').eq('transaction_date',localDateValue()).in('type',['sale','payment']).order('id',{ascending:false}).limit(10); if(error||!rows?.length)return;
        const matching=[]; const sale=rows.find((row)=>row.type==='sale'&&Number(row.amount)===launch.purchase); if(sale)matching.push(sale);
        if(launch.paid>0){const payment=rows.find((row)=>row.type==='payment'&&Number(row.amount)===launch.paid&&!matching.some((x)=>x.id===row.id));if(payment)matching.push(payment);}
        for(const row of matching) await supabase.from('customer_transactions').update({transaction_date:launch.date}).eq('id',row.id).eq('status','posted');
      },700);
    };
    const observer=new MutationObserver(ensureLaunchDateField); observer.observe(document.body,{childList:true,subtree:true}); ensureLaunchDateField();
    const openA4Report=(event)=>{const button=event.target?.closest?.('button');if(!button||!(button.textContent||'').includes('Imprimir relatório A4'))return;event.preventDefault();event.stopPropagation();const dateInputs=Array.from(document.querySelectorAll('input[type="date"]'));const selects=Array.from(document.querySelectorAll('select'));const from=dateInputs[0]?.value||'';const to=dateInputs[1]?.value||'';const customerSelect=selects.find((select)=>Array.from(select.options).some((option)=>(option.textContent||'').includes('Todos os clientes')));const customerValue=customerSelect?.value||'';const kindSelect=selects.find((select)=>Array.from(select.options).some((option)=>(option.textContent||'').includes('Todos os lançamentos')));const kind=kindSelect?.value||'all';const params=new URLSearchParams({from,to,kind});if(customerValue.startsWith('group:'))params.set('customer_group',customerValue.slice(6));else if(customerValue)params.set('customer_id',customerValue);window.location.href=`/relatorio-impressao?${params.toString()}`;};
    const printWithReceipt=async()=>{if(document.querySelector('.receipt')){originalPrint();return;}if(printing||!pendingCustomerId){originalPrint();return;}printing=true;let printStyle;try{const [{data:customer},{data:rows,error}]=await Promise.all([supabase.from('customers').select('id,name,store_name').eq('id',pendingCustomerId).maybeSingle(),supabase.from('customer_transactions').select('id,customer_id,type,amount,payment_method,transaction_date,description,status').eq('customer_id',pendingCustomerId).eq('status','posted').in('type',['sale','payment','credit']).order('transaction_date',{ascending:true})]);if(error||!customer){originalPrint();return;}buildReceipt({customer,rows:rows||[]});printStyle=document.createElement('style');printStyle.id='sany-fiscal-print-override';printStyle.textContent=`@media print{@page{size:auto!important;margin:0!important}html,body{width:100%!important;min-width:0!important;max-width:none!important;height:auto!important;margin:0!important;padding:0!important;background:#fff!important;overflow:visible!important}body>#sany-inline-print-receipt{display:block!important;width:100%!important;max-width:none!important;margin:0!important;padding:3mm 4mm 5mm!important;box-sizing:border-box!important;background:#fff!important;color:#000!important;font-family:Arial,sans-serif!important;font-size:16px!important;line-height:1.15!important}body>.app{display:none!important}body>#sany-inline-print-receipt .receipt-date{font-size:16px!important;margin:0 0 2mm!important}body>#sany-inline-print-receipt .receipt-title{width:100%!important;font-size:26px!important;line-height:1.05!important;padding:6px 4px!important;box-sizing:border-box!important}body>#sany-inline-print-receipt .receipt-section{width:100%!important;margin-top:3mm!important}body>#sany-inline-print-receipt .receipt-row{width:100%!important;grid-template-columns:minmax(0,1fr) 30px 90px!important;min-height:28px!important;font-size:17px!important}body>#sany-inline-print-receipt .receipt-row>*{padding:3px 4px!important}body>#sany-inline-print-receipt .receipt-head{min-height:32px!important;font-size:16px!important}body>#sany-inline-print-receipt .blank-row{min-height:28px!important}body>#sany-inline-print-receipt .receipt-total{width:100%!important;grid-template-columns:minmax(0,1fr) 115px!important;min-height:35px!important;font-size:19px!important}body>#sany-inline-print-receipt .receipt-summary{width:100%!important;margin-top:3mm!important}body>#sany-inline-print-receipt .summary-row{font-size:19px!important;padding:2px 0!important}body>#sany-inline-print-receipt .balance-row{padding:5px!important;font-size:20px!important}body>#sany-inline-print-receipt .payment-section{width:100%!important;margin-top:4mm!important}body>#sany-inline-print-receipt .payment-row{width:100%!important;grid-template-columns:minmax(0,1fr) 30px 90px!important;min-height:28px!important;font-size:17px!important}body>#sany-inline-print-receipt .payment-row>*{padding:3px 4px!important}body>#sany-inline-print-receipt .payment-total{font-size:18px!important;padding:5px!important}body>#sany-inline-print-receipt .receipt-footer{font-size:12px!important;margin-top:3mm!important}}`;document.head.appendChild(printStyle);originalPrint();}finally{setTimeout(()=>{document.getElementById('sany-inline-print-receipt')?.remove();document.getElementById('sany-fiscal-print-override')?.remove();pendingCustomerId='';printing=false;},1500);}};
    document.addEventListener('click',openA4Report,true); document.addEventListener('click',captureCustomer,true); document.addEventListener('submit',captureLaunch,true); window.print=printWithReceipt;
    return()=>{observer.disconnect();document.removeEventListener('click',openA4Report,true);document.removeEventListener('click',captureCustomer,true);document.removeEventListener('submit',captureLaunch,true);window.print=originalPrint;document.getElementById('sany-inline-print-receipt')?.remove();document.getElementById('sany-fiscal-print-override')?.remove();};
  },[]);
  return null;
}
