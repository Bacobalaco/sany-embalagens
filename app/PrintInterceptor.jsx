'use client';

import { useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
);

const moneyNumber = (v) => Number(v || 0).toLocaleString('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const methodLabel = (v) => ({
  credit: 'CONTA',
  pix: 'PIX',
  cash: 'DINHEIRO',
  card: 'CARTÃO',
  check: 'CHEQUE',
  transfer: 'TRANSFERÊNCIA',
  other: 'OUTRO',
}[v] || 'OUTRO');

function escapeText(value) {
  return String(value ?? '').replace(/[&<>\"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '\"': '&quot;',
    "'": '&#039;',
  }[char]));
}

function buildReceipt({ customer, rows }) {
  document.getElementById('sany-inline-print-receipt')?.remove();

  const purchases = rows.filter((x) => x.type === 'sale');
  const payments = rows.filter((x) => ['payment', 'credit'].includes(x.type));
  const totalPurchases = purchases.reduce((sum, x) => sum + Number(x.amount || 0), 0);
  const totalPayments = payments.reduce((sum, x) => sum + Number(x.amount || 0), 0);
  const balance = totalPurchases - totalPayments;
  const byMethod = Array.from(payments.reduce((map, x) => {
    const key = x.payment_method || 'other';
    map.set(key, (map.get(key) || 0) + Number(x.amount || 0));
    return map;
  }, new Map()).entries());

  const today = new Date().toLocaleDateString('pt-BR');
  const purchaseRows = purchases.map((x) => `
    <div class="receipt-row data-row">
      <span>${escapeText((x.description || 'COMPRA').toUpperCase())}</span>
      <span>R$</span>
      <strong>${moneyNumber(x.amount)}</strong>
    </div>
  `).join('');

  const blankRows = Array.from({ length: Math.max(0, 8 - purchases.length) }, () => `
    <div class="receipt-row blank-row"><span></span><span></span><span></span></div>
  `).join('');

  const paymentRows = byMethod.map(([method, amount]) => `
    <div class="payment-row">
      <strong>${escapeText(methodLabel(method))}</strong>
      <span>R$</span>
      <strong>${moneyNumber(amount)}</strong>
    </div>
  `).join('');

  const receipt = document.createElement('section');
  receipt.id = 'sany-inline-print-receipt';
  receipt.className = 'inline-print-receipt';
  receipt.innerHTML = `
    <div class="receipt-date">${today}</div>
    <div class="receipt-title">${escapeText(customer?.name || 'CLIENTE')}</div>

    <div class="receipt-section purchase-section">
      <div class="receipt-row receipt-head"><strong>DEVE</strong><span>R$</span><strong>VALOR</strong></div>
      ${purchaseRows}
      ${blankRows}
      <div class="receipt-total"><span>R$</span><strong>${moneyNumber(totalPurchases)}</strong></div>
    </div>

    <div class="receipt-summary">
      <div class="summary-row paid-row"><strong>PAGOU</strong><strong>${moneyNumber(totalPayments)}</strong></div>
      <div class="summary-row balance-row"><strong>DEVE</strong><span><b>R$</b><strong>${moneyNumber(balance)}</strong></span></div>
    </div>

    <div class="payment-section">
      ${paymentRows || '<div class="payment-row"><strong></strong><span>R$</span><strong>0,00</strong></div>'}
      <div class="payment-total"><span>R$</span><strong>${moneyNumber(totalPayments)}</strong></div>
    </div>

    <div class="receipt-footer">SANY EMBALAGENS</div>
  `;

  document.body.appendChild(receipt);
}

export default function PrintInterceptor() {
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    let pendingCustomerId = '';
    const originalPrint = window.print.bind(window);
    let printing = false;

    const captureCustomer = () => {
      const customerSelect = Array.from(document.querySelectorAll('select')).find((select) => {
        const optionsText = Array.from(select.options).map((option) => option.textContent || '').join(' | ').toLowerCase();
        return optionsText.includes('selecione o cliente') && select.value;
      });
      if (customerSelect?.value) pendingCustomerId = customerSelect.value;
    };

    const printWithReceipt = async () => {
      // The dedicated /impressao page already renders its own receipt.
      if (document.querySelector('.receipt')) {
        originalPrint();
        return;
      }

      if (printing || !pendingCustomerId) {
        originalPrint();
        return;
      }

      printing = true;
      let printStyle;
      try {
        const [{ data: customer }, { data: rows, error }] = await Promise.all([
          supabase.from('customers').select('id,name,store_name').eq('id', pendingCustomerId).maybeSingle(),
          supabase.from('customer_transactions')
            .select('id,customer_id,type,amount,payment_method,transaction_date,description,status')
            .eq('customer_id', pendingCustomerId)
            .eq('status', 'posted')
            .in('type', ['sale', 'payment', 'credit'])
            .order('transaction_date', { ascending: true }),
        ]);

        if (error || !customer) {
          originalPrint();
          return;
        }

        buildReceipt({ customer, rows: rows || [] });

        // This style is injected LAST, after the inline print CSS from page.jsx.
        // The printer/driver can report A4 even when the physical paper is a roll,
        // so the receipt must use the full printable page width instead of 80mm.
        printStyle = document.createElement('style');
        printStyle.id = 'sany-fiscal-print-override';
        printStyle.textContent = `
          @media print {
            @page { size: auto !important; margin: 0 !important; }
            html, body {
              width: 100% !important;
              min-width: 0 !important;
              max-width: none !important;
              height: auto !important;
              margin: 0 !important;
              padding: 0 !important;
              background: #fff !important;
              overflow: visible !important;
            }
            body > #sany-inline-print-receipt {
              display: block !important;
              width: 100% !important;
              max-width: none !important;
              margin: 0 !important;
              padding: 3mm 4mm 5mm !important;
              box-sizing: border-box !important;
              background: #fff !important;
              color: #000 !important;
              font-family: Arial, sans-serif !important;
              font-size: 16px !important;
              line-height: 1.15 !important;
            }
            body > .app { display: none !important; }
            body > #sany-inline-print-receipt .receipt-date {
              font-size: 16px !important;
              margin: 0 0 2mm !important;
            }
            body > #sany-inline-print-receipt .receipt-title {
              width: 100% !important;
              font-size: 26px !important;
              line-height: 1.05 !important;
              padding: 6px 4px !important;
              box-sizing: border-box !important;
            }
            body > #sany-inline-print-receipt .receipt-section {
              width: 100% !important;
              margin-top: 3mm !important;
            }
            body > #sany-inline-print-receipt .receipt-row {
              width: 100% !important;
              grid-template-columns: minmax(0, 1fr) 30px 90px !important;
              min-height: 28px !important;
              font-size: 17px !important;
            }
            body > #sany-inline-print-receipt .receipt-row > * {
              padding: 3px 4px !important;
            }
            body > #sany-inline-print-receipt .receipt-head {
              min-height: 32px !important;
              font-size: 16px !important;
            }
            body > #sany-inline-print-receipt .blank-row {
              min-height: 28px !important;
            }
            body > #sany-inline-print-receipt .receipt-total {
              width: 100% !important;
              grid-template-columns: minmax(0, 1fr) 115px !important;
              min-height: 35px !important;
              font-size: 19px !important;
            }
            body > #sany-inline-print-receipt .receipt-summary {
              width: 100% !important;
              margin-top: 3mm !important;
            }
            body > #sany-inline-print-receipt .summary-row {
              font-size: 19px !important;
              padding: 2px 0 !important;
            }
            body > #sany-inline-print-receipt .balance-row {
              padding: 5px !important;
              font-size: 20px !important;
            }
            body > #sany-inline-print-receipt .payment-section {
              width: 100% !important;
              margin-top: 4mm !important;
            }
            body > #sany-inline-print-receipt .payment-row {
              width: 100% !important;
              grid-template-columns: minmax(0, 1fr) 30px 90px !important;
              min-height: 28px !important;
              font-size: 17px !important;
            }
            body > #sany-inline-print-receipt .payment-row > * {
              padding: 3px 4px !important;
            }
            body > #sany-inline-print-receipt .payment-total {
              font-size: 18px !important;
              padding: 5px !important;
            }
            body > #sany-inline-print-receipt .receipt-footer {
              font-size: 12px !important;
              margin-top: 3mm !important;
            }
          }
        `;
        document.head.appendChild(printStyle);
        originalPrint();
      } finally {
        setTimeout(() => {
          document.getElementById('sany-inline-print-receipt')?.remove();
          document.getElementById('sany-fiscal-print-override')?.remove();
          pendingCustomerId = '';
          printing = false;
        }, 1500);
      }
    };

    document.addEventListener('click', captureCustomer, true);
    window.print = printWithReceipt;

    return () => {
      document.removeEventListener('click', captureCustomer, true);
      window.print = originalPrint;
      document.getElementById('sany-inline-print-receipt')?.remove();
      document.getElementById('sany-fiscal-print-override')?.remove();
    };
  }, []);

  return null;
}
