/* E-Rechnung lesen: XRechnung/ZUGFeRD (CII) und XRechnung (UBL) in ein einheitliches
   Modell überführen. Die Datei verlässt dabei den Browser nicht. */
(function (root) {
  'use strict';

  const kids = (n, name) => n ? Array.from(n.children).filter(c => c.localName === name) : [];
  function at(n, path) {
    for (const p of path.split('/')) { if (!n) return null; n = kids(n, p)[0]; }
    return n || null;
  }
  const tx = (n, path) => { const e = path ? at(n, path) : n; return e ? e.textContent.trim() : ''; };
  const num = v => { const n = parseFloat(v); return isNaN(n) ? null : n; };

  function isoDate(v) {
    v = String(v || '').trim();
    if (/^\d{8}$/.test(v)) return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
    return v.slice(0, 10);
  }

  const TYPE_NAMES = { '380': 'Rechnung', '381': 'Gutschrift', '384': 'Korrekturrechnung', '389': 'Gutschrift (Selbstfakturierung)', '326': 'Teilrechnung', '875': 'Abschlagsrechnung', '876': 'Abschlagsrechnung', '877': 'Schlussrechnung' };

  function ciiParty(p) {
    const regs = kids(p, 'SpecifiedTaxRegistration').map(r => at(r, 'ID')).filter(Boolean);
    const reg = scheme => { const r = regs.find(x => x.getAttribute('schemeID') === scheme); return r ? r.textContent.trim() : ''; };
    return {
      name: tx(p, 'Name'),
      street: [tx(p, 'PostalTradeAddress/LineOne'), tx(p, 'PostalTradeAddress/LineTwo')].filter(Boolean).join(', '),
      zip: tx(p, 'PostalTradeAddress/PostcodeCode'), city: tx(p, 'PostalTradeAddress/CityName'),
      country: tx(p, 'PostalTradeAddress/CountryID'),
      vatId: reg('VA'), taxNumber: reg('FC'),
      contactName: tx(p, 'DefinedTradeContact/PersonName'),
      phone: tx(p, 'DefinedTradeContact/TelephoneUniversalCommunication/CompleteNumber'),
      email: tx(p, 'DefinedTradeContact/EmailURIUniversalCommunication/URIID') || tx(p, 'URIUniversalCommunication/URIID')
    };
  }

  function parseCii(root) {
    const doc = at(root, 'ExchangedDocument');
    const t = at(root, 'SupplyChainTradeTransaction');
    const agr = at(t, 'ApplicableHeaderTradeAgreement');
    const set = at(t, 'ApplicableHeaderTradeSettlement');
    const sum = at(set, 'SpecifiedTradeSettlementHeaderMonetarySummation');
    const pm = at(set, 'SpecifiedTradeSettlementPaymentMeans');
    const typeCode = tx(doc, 'TypeCode');
    return {
      syntax: 'CII', profile: tx(root, 'ExchangedDocumentContext/GuidelineSpecifiedDocumentContextParameter/ID'),
      typeCode, typeName: TYPE_NAMES[typeCode] || 'Rechnung',
      number: tx(doc, 'ID'), issueDate: isoDate(tx(doc, 'IssueDateTime/DateTimeString')),
      deliveryDate: isoDate(tx(t, 'ApplicableHeaderTradeDelivery/ActualDeliverySupplyChainEvent/OccurrenceDateTime/DateTimeString')),
      dueDate: isoDate(tx(set, 'SpecifiedTradePaymentTerms/DueDateDateTime/DateTimeString')),
      paymentTerms: tx(set, 'SpecifiedTradePaymentTerms/Description'),
      buyerReference: tx(agr, 'BuyerReference'),
      notes: kids(doc, 'IncludedNote').map(n => tx(n, 'Content')).filter(Boolean),
      currency: tx(set, 'InvoiceCurrencyCode') || 'EUR',
      seller: ciiParty(at(agr, 'SellerTradeParty')), buyer: ciiParty(at(agr, 'BuyerTradeParty')),
      payment: {
        iban: tx(pm, 'PayeePartyCreditorFinancialAccount/IBANID'),
        accountName: tx(pm, 'PayeePartyCreditorFinancialAccount/AccountName'),
        bic: tx(pm, 'PayeeSpecifiedCreditorFinancialInstitution/BICID'),
        reference: tx(set, 'PaymentReference')
      },
      lines: kids(t, 'IncludedSupplyChainTradeLineItem').map(l => {
        const q = at(l, 'SpecifiedLineTradeDelivery/BilledQuantity');
        return {
          id: tx(l, 'AssociatedDocumentLineDocument/LineID'),
          name: tx(l, 'SpecifiedTradeProduct/Name'), description: tx(l, 'SpecifiedTradeProduct/Description'),
          quantity: num(tx(q)), unit: q ? q.getAttribute('unitCode') || '' : '',
          price: num(tx(l, 'SpecifiedLineTradeAgreement/NetPriceProductTradePrice/ChargeAmount')),
          rate: num(tx(l, 'SpecifiedLineTradeSettlement/ApplicableTradeTax/RateApplicablePercent')),
          net: num(tx(l, 'SpecifiedLineTradeSettlement/SpecifiedTradeSettlementLineMonetarySummation/LineTotalAmount'))
        };
      }),
      taxes: kids(set, 'ApplicableTradeTax').map(g => ({
        category: tx(g, 'CategoryCode'), rate: num(tx(g, 'RateApplicablePercent')),
        basis: num(tx(g, 'BasisAmount')), tax: num(tx(g, 'CalculatedAmount')), reason: tx(g, 'ExemptionReason')
      })),
      totals: {
        net: num(tx(sum, 'TaxBasisTotalAmount')), tax: num(tx(sum, 'TaxTotalAmount')),
        gross: num(tx(sum, 'GrandTotalAmount')), prepaid: num(tx(sum, 'TotalPrepaidAmount')),
        due: num(tx(sum, 'DuePayableAmount'))
      }
    };
  }

  function ublParty(p) {
    const ids = kids(p, 'PartyTaxScheme').map(s => ({ id: tx(s, 'CompanyID'), scheme: tx(s, 'TaxScheme/ID') }));
    const vat = ids.find(i => i.scheme.toUpperCase() === 'VAT');
    const other = ids.find(i => i.scheme.toUpperCase() !== 'VAT');
    return {
      name: tx(p, 'PartyLegalEntity/RegistrationName') || tx(p, 'PartyName/Name'),
      street: [tx(p, 'PostalAddress/StreetName'), tx(p, 'PostalAddress/AdditionalStreetName')].filter(Boolean).join(', '),
      zip: tx(p, 'PostalAddress/PostalZone'), city: tx(p, 'PostalAddress/CityName'),
      country: tx(p, 'PostalAddress/Country/IdentificationCode'),
      vatId: vat ? vat.id : '', taxNumber: other ? other.id : '',
      contactName: tx(p, 'Contact/Name'), phone: tx(p, 'Contact/Telephone'),
      email: tx(p, 'Contact/ElectronicMail') || tx(p, 'EndpointID')
    };
  }

  function parseUbl(root) {
    const credit = root.localName === 'CreditNote';
    const typeCode = tx(root, credit ? 'CreditNoteTypeCode' : 'InvoiceTypeCode') || (credit ? '381' : '380');
    const pm = at(root, 'PaymentMeans');
    const sum = at(root, 'LegalMonetaryTotal');
    const taxTotal = at(root, 'TaxTotal');
    return {
      syntax: 'UBL', profile: tx(root, 'CustomizationID'),
      typeCode, typeName: TYPE_NAMES[typeCode] || (credit ? 'Gutschrift' : 'Rechnung'),
      number: tx(root, 'ID'), issueDate: isoDate(tx(root, 'IssueDate')),
      deliveryDate: isoDate(tx(root, 'Delivery/ActualDeliveryDate')),
      dueDate: isoDate(tx(root, 'DueDate') || tx(pm, 'PaymentDueDate')),
      paymentTerms: tx(root, 'PaymentTerms/Note'),
      buyerReference: tx(root, 'BuyerReference'),
      notes: kids(root, 'Note').map(n => tx(n)).filter(Boolean),
      currency: tx(root, 'DocumentCurrencyCode') || 'EUR',
      seller: ublParty(at(root, 'AccountingSupplierParty/Party')),
      buyer: ublParty(at(root, 'AccountingCustomerParty/Party')),
      payment: {
        iban: tx(pm, 'PayeeFinancialAccount/ID'), accountName: tx(pm, 'PayeeFinancialAccount/Name'),
        bic: tx(pm, 'PayeeFinancialAccount/FinancialInstitutionBranch/ID'), reference: tx(pm, 'PaymentID')
      },
      lines: kids(root, credit ? 'CreditNoteLine' : 'InvoiceLine').map(l => {
        const q = at(l, credit ? 'CreditedQuantity' : 'InvoicedQuantity');
        return {
          id: tx(l, 'ID'), name: tx(l, 'Item/Name'), description: tx(l, 'Item/Description'),
          quantity: num(tx(q)), unit: q ? q.getAttribute('unitCode') || '' : '',
          price: num(tx(l, 'Price/PriceAmount')),
          rate: num(tx(l, 'Item/ClassifiedTaxCategory/Percent')),
          net: num(tx(l, 'LineExtensionAmount'))
        };
      }),
      taxes: kids(taxTotal, 'TaxSubtotal').map(g => ({
        category: tx(g, 'TaxCategory/ID'), rate: num(tx(g, 'TaxCategory/Percent')),
        basis: num(tx(g, 'TaxableAmount')), tax: num(tx(g, 'TaxAmount')), reason: tx(g, 'TaxCategory/TaxExemptionReason')
      })),
      totals: {
        net: num(tx(sum, 'TaxExclusiveAmount')), tax: num(tx(taxTotal, 'TaxAmount')),
        gross: num(tx(sum, 'TaxInclusiveAmount')), prepaid: num(tx(sum, 'PrepaidAmount')),
        due: num(tx(sum, 'PayableAmount'))
      }
    };
  }

  function parseXml(text) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    const root = doc.documentElement;
    if (!root || doc.getElementsByTagName('parsererror').length) throw new Error('Die Datei ist kein gültiges XML.');
    if (root.localName === 'CrossIndustryInvoice') return parseCii(root);
    if (root.localName === 'Invoice' || root.localName === 'CreditNote') return parseUbl(root);
    throw new Error('Das XML ist keine E-Rechnung im Format XRechnung oder ZUGFeRD.');
  }

  /* ---- ZUGFeRD: eingebettetes XML aus einer PDF holen ---- */

  function indexOf(bytes, pat, from) {
    outer: for (let i = from; i <= bytes.length - pat.length; i++) {
      for (let j = 0; j < pat.length; j++) if (bytes[i + j] !== pat[j]) continue outer;
      return i;
    }
    return -1;
  }
  const ascii = s => Array.from(s, c => c.charCodeAt(0));

  async function inflate(bytes) {
    const ds = new DecompressionStream('deflate');
    const writer = ds.writable.getWriter();
    writer.write(bytes).catch(() => {});
    writer.close().catch(() => {});
    const reader = ds.readable.getReader();
    const chunks = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value); size += value.length;
        if (size > 20e6) break;
      }
    } catch (e) { /* Reste hinter den komprimierten Daten: bisherige Ausgabe behalten */ }
    const out = new Uint8Array(size);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
  }

  function looksLikeInvoice(bytes) {
    const head = new TextDecoder('utf-8').decode(bytes.subarray(0, Math.min(bytes.length, 4000)));
    return /<(\w+:)?(CrossIndustryInvoice|CrossIndustryDocument|Invoice|CreditNote)[\s>]/.test(head);
  }

  async function xmlFromPdf(buffer) {
    const bytes = new Uint8Array(buffer);
    const S = ascii('stream'), E = ascii('endstream');
    let pos = 0;
    for (;;) {
      const s = indexOf(bytes, S, pos);
      if (s < 0) break;
      let start = s + S.length;
      if (bytes[start] === 13) start++;
      if (bytes[start] === 10) start++;
      const end = indexOf(bytes, E, start);
      if (end < 0) break;
      pos = end + E.length;
      let stop = end;
      while (stop > start && (bytes[stop - 1] === 10 || bytes[stop - 1] === 13)) stop--;
      const raw = bytes.subarray(start, stop);
      if (!raw.length || raw.length > 20e6) continue;
      let data = raw;
      if (!looksLikeInvoice(raw)) {
        if ((raw[0] & 0x0f) !== 8) continue; // kein zlib-Datenstrom
        data = await inflate(raw);
        if (!looksLikeInvoice(data)) continue;
      }
      return new TextDecoder('utf-8').decode(data);
    }
    throw new Error('In dieser PDF ist keine E-Rechnung eingebettet. Es handelt sich vermutlich um eine gewöhnliche PDF-Rechnung.');
  }

  async function readFile(file) {
    const buffer = await file.arrayBuffer();
    const head = new TextDecoder('latin1').decode(new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 1024)));
    const xml = head.includes('%PDF-') ? await xmlFromPdf(buffer) : new TextDecoder('utf-8').decode(buffer);
    const model = parseXml(xml.replace(/^﻿/, ''));
    model.source = head.includes('%PDF-') ? 'ZUGFeRD-PDF' : 'XML';
    return model;
  }

  root.ERechnungReader = { parseXml, xmlFromPdf, readFile };
})(typeof self !== 'undefined' ? self : this);
