/* E-Rechnung: Berechnung, Prüfung und XML-Erzeugung (XRechnung 3.0, CII-Syntax).
   Läuft im Browser und in Node, ohne Abhängigkeiten. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ERechnungCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const GUIDELINE = 'urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0';
  const PROCESS = 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0';
  const SMALL_BUSINESS_REASON = 'Kein Ausweis von Umsatzsteuer, da Kleinunternehmer gemäß § 19 UStG';

  const UNITS = {
    H87: 'Stück', HUR: 'Stunde', DAY: 'Tag', LS: 'pauschal', C62: 'Einheit',
    KGM: 'kg', MTR: 'm', MTK: 'm²', LTR: 'l', KMT: 'km', MON: 'Monat'
  };

  // Kaufmännisches Runden auf 2 Stellen ohne Gleitkomma-Ausreißer (1.005 -> 1.01)
  function round2(n) {
    return Number(Math.round(Number(n + 'e2')) + 'e-2');
  }
  const money = n => round2(n).toFixed(2);
  function trimNum(n, minDec, maxDec) {
    let s = Number(n).toFixed(maxDec);
    while (s.includes('.') && s.endsWith('0') && s.split('.')[1].length > minDec) s = s.slice(0, -1);
    if (s.endsWith('.')) s = s.slice(0, -1);
    return s;
  }

  function calc(inv) {
    const lines = (inv.lines || []).map((l, i) => {
      const quantity = Number(l.quantity) || 0;
      const price = Number(l.price) || 0;
      const rate = inv.smallBusiness ? 0 : Number(l.vatRate) || 0;
      return {
        id: String(i + 1), name: l.name || '', description: l.description || '',
        quantity, unit: l.unit || 'H87', price, rate,
        category: inv.smallBusiness ? 'E' : 'S',
        net: round2(quantity * price)
      };
    });
    const groups = [];
    for (const l of lines) {
      let g = groups.find(x => x.category === l.category && x.rate === l.rate);
      if (!g) groups.push(g = { category: l.category, rate: l.rate, basis: 0, tax: 0 });
      g.basis = round2(g.basis + l.net);
    }
    for (const g of groups) g.tax = round2(g.basis * g.rate / 100);
    groups.sort((a, b) => b.rate - a.rate);
    const net = round2(lines.reduce((s, l) => s + l.net, 0));
    const tax = round2(groups.reduce((s, g) => s + g.tax, 0));
    return { lines, groups, net, tax, gross: round2(net + tax) };
  }

  function ibanValid(iban) {
    const s = String(iban || '').replace(/\s+/g, '').toUpperCase();
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
    const moved = s.slice(4) + s.slice(0, 4);
    let rem = 0;
    for (const ch of moved) {
      const v = ch >= 'A' ? String(ch.charCodeAt(0) - 55) : ch;
      for (const d of v) rem = (rem * 10 + Number(d)) % 97;
    }
    return rem === 1;
  }
  const emailValid = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || ''));
  const dateValid = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) && !isNaN(Date.parse(d));

  /* Prüft die Pflichtangaben. Gibt eine Liste verständlicher Fehlermeldungen zurück. */
  function validate(inv) {
    const e = [];
    const s = inv.seller || {}, b = inv.buyer || {};
    const need = (v, msg) => { if (!String(v == null ? '' : v).trim()) e.push(msg); };
    need(inv.number, 'Rechnungsnummer fehlt.');
    if (!dateValid(inv.issueDate)) e.push('Rechnungsdatum fehlt oder ist ungültig.');
    if (inv.deliveryDate && !dateValid(inv.deliveryDate)) e.push('Leistungsdatum ist ungültig.');
    if (inv.dueDate && !dateValid(inv.dueDate)) e.push('Fälligkeitsdatum ist ungültig.');
    if (!inv.dueDate && !String(inv.paymentTerms || '').trim()) e.push('Bitte ein Fälligkeitsdatum oder Zahlungsbedingungen angeben.');
    need(s.name, 'Dein Name bzw. Firmenname fehlt.');
    need(s.street, 'Deine Straße fehlt.');
    need(s.zip, 'Deine Postleitzahl fehlt.');
    need(s.city, 'Dein Ort fehlt.');
    if (!String(s.vatId || '').trim() && !String(s.taxNumber || '').trim()) e.push('Bitte USt-IdNr. oder Steuernummer angeben.');
    if (s.vatId && !/^[A-Z]{2}[A-Z0-9]{2,12}$/.test(String(s.vatId).replace(/\s+/g, '').toUpperCase())) e.push('Die USt-IdNr. hat kein gültiges Format (Beispiel: DE123456789).');
    need(s.contactName, 'Ansprechpartner fehlt (bei der XRechnung Pflicht).');
    need(s.phone, 'Deine Telefonnummer fehlt (bei der XRechnung Pflicht).');
    if (!emailValid(s.email)) e.push('Deine E-Mail-Adresse fehlt oder ist ungültig.');
    if (!ibanValid(s.iban)) e.push('Die IBAN fehlt oder ist ungültig.');
    need(b.name, 'Name des Kunden fehlt.');
    need(b.street, 'Straße des Kunden fehlt.');
    need(b.zip, 'Postleitzahl des Kunden fehlt.');
    need(b.city, 'Ort des Kunden fehlt.');
    if (!emailValid(b.email)) e.push('E-Mail-Adresse des Kunden fehlt oder ist ungültig (bei der XRechnung Pflicht).');
    const lines = inv.lines || [];
    if (!lines.length) e.push('Die Rechnung braucht mindestens eine Position.');
    lines.forEach((l, i) => {
      const n = i + 1;
      if (!String(l.name || '').trim()) e.push(`Position ${n}: Bezeichnung fehlt.`);
      if (!(Number(l.quantity) > 0)) e.push(`Position ${n}: Menge muss größer als 0 sein.`);
      if (!(Number(l.price) >= 0) || l.price === '' || l.price == null) e.push(`Position ${n}: Einzelpreis fehlt.`);
      if (!inv.smallBusiness && ![7, 19].includes(Number(l.vatRate))) e.push(`Position ${n}: Steuersatz muss 19 % oder 7 % sein.`);
    });
    return e;
  }

  const esc = v => String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const d102 = d => String(d).replace(/-/g, '');
  const tag = (name, value, attrs) => {
    const v = String(value == null ? '' : value).trim();
    return v ? `<${name}${attrs ? ' ' + attrs : ''}>${esc(v)}</${name}>` : '';
  };
  const dateEl = (name, d) => d ? `<${name}><udt:DateTimeString format="102">${d102(d)}</udt:DateTimeString></${name}>` : '';

  function address(p) {
    return '<ram:PostalTradeAddress>' + tag('ram:PostcodeCode', p.zip) + tag('ram:LineOne', p.street) +
      tag('ram:CityName', p.city) + tag('ram:CountryID', (p.country || 'DE').toUpperCase()) + '</ram:PostalTradeAddress>';
  }

  /* Erzeugt die XRechnung als XML-Text. Vorher validate() aufrufen. */
  function buildXml(inv) {
    const c = calc(inv);
    const s = inv.seller, b = inv.buyer;
    const vatId = String(s.vatId || '').replace(/\s+/g, '').toUpperCase();
    const taxNumber = String(s.taxNumber || '').trim();
    const iban = String(s.iban || '').replace(/\s+/g, '').toUpperCase();
    const buyerVat = String(b.vatId || '').replace(/\s+/g, '').toUpperCase();
    const x = [];
    x.push('<?xml version="1.0" encoding="UTF-8"?>');
    x.push('<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" ' +
      'xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" ' +
      'xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100" ' +
      'xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100">');
    x.push('<rsm:ExchangedDocumentContext>' +
      `<ram:BusinessProcessSpecifiedDocumentContextParameter><ram:ID>${PROCESS}</ram:ID></ram:BusinessProcessSpecifiedDocumentContextParameter>` +
      `<ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>${GUIDELINE}</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter>` +
      '</rsm:ExchangedDocumentContext>');
    x.push('<rsm:ExchangedDocument>' + tag('ram:ID', inv.number) + '<ram:TypeCode>380</ram:TypeCode>' +
      dateEl('ram:IssueDateTime', inv.issueDate) +
      (String(inv.note || '').trim() ? `<ram:IncludedNote>${tag('ram:Content', inv.note)}</ram:IncludedNote>` : '') +
      '</rsm:ExchangedDocument>');
    x.push('<rsm:SupplyChainTradeTransaction>');
    for (const l of c.lines) {
      x.push('<ram:IncludedSupplyChainTradeLineItem>' +
        `<ram:AssociatedDocumentLineDocument><ram:LineID>${l.id}</ram:LineID></ram:AssociatedDocumentLineDocument>` +
        `<ram:SpecifiedTradeProduct>${tag('ram:Name', l.name)}${tag('ram:Description', l.description)}</ram:SpecifiedTradeProduct>` +
        `<ram:SpecifiedLineTradeAgreement><ram:NetPriceProductTradePrice><ram:ChargeAmount>${trimNum(l.price, 2, 4)}</ram:ChargeAmount></ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement>` +
        `<ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="${esc(l.unit)}">${trimNum(l.quantity, 0, 4)}</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>` +
        '<ram:SpecifiedLineTradeSettlement>' +
        `<ram:ApplicableTradeTax><ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>${l.category}</ram:CategoryCode><ram:RateApplicablePercent>${trimNum(l.rate, 0, 2)}</ram:RateApplicablePercent></ram:ApplicableTradeTax>` +
        `<ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>${money(l.net)}</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation>` +
        '</ram:SpecifiedLineTradeSettlement></ram:IncludedSupplyChainTradeLineItem>');
    }
    x.push('<ram:ApplicableHeaderTradeAgreement>' +
      tag('ram:BuyerReference', String(inv.buyerReference || '').trim() || inv.number) +
      '<ram:SellerTradeParty>' +
      // Ohne USt-IdNr. dient die Steuernummer zusätzlich als Verkäuferkennung (EN 16931, BR-CO-26)
      (vatId ? '' : tag('ram:ID', taxNumber)) +
      tag('ram:Name', s.name) +
      '<ram:DefinedTradeContact>' + tag('ram:PersonName', s.contactName) +
      `<ram:TelephoneUniversalCommunication>${tag('ram:CompleteNumber', s.phone)}</ram:TelephoneUniversalCommunication>` +
      `<ram:EmailURIUniversalCommunication>${tag('ram:URIID', s.email)}</ram:EmailURIUniversalCommunication>` +
      '</ram:DefinedTradeContact>' +
      address(s) +
      `<ram:URIUniversalCommunication>${tag('ram:URIID', s.email, 'schemeID="EM"')}</ram:URIUniversalCommunication>` +
      (vatId ? `<ram:SpecifiedTaxRegistration>${tag('ram:ID', vatId, 'schemeID="VA"')}</ram:SpecifiedTaxRegistration>` : '') +
      (taxNumber ? `<ram:SpecifiedTaxRegistration>${tag('ram:ID', taxNumber, 'schemeID="FC"')}</ram:SpecifiedTaxRegistration>` : '') +
      '</ram:SellerTradeParty>' +
      '<ram:BuyerTradeParty>' + tag('ram:Name', b.name) + address(b) +
      `<ram:URIUniversalCommunication>${tag('ram:URIID', b.email, 'schemeID="EM"')}</ram:URIUniversalCommunication>` +
      (buyerVat ? `<ram:SpecifiedTaxRegistration>${tag('ram:ID', buyerVat, 'schemeID="VA"')}</ram:SpecifiedTaxRegistration>` : '') +
      '</ram:BuyerTradeParty></ram:ApplicableHeaderTradeAgreement>');
    x.push('<ram:ApplicableHeaderTradeDelivery>' +
      (inv.deliveryDate ? `<ram:ActualDeliverySupplyChainEvent>${dateEl('ram:OccurrenceDateTime', inv.deliveryDate)}</ram:ActualDeliverySupplyChainEvent>` : '') +
      '</ram:ApplicableHeaderTradeDelivery>');
    x.push('<ram:ApplicableHeaderTradeSettlement>' + tag('ram:PaymentReference', inv.number) +
      '<ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>' +
      '<ram:SpecifiedTradeSettlementPaymentMeans><ram:TypeCode>58</ram:TypeCode>' +
      `<ram:PayeePartyCreditorFinancialAccount>${tag('ram:IBANID', iban)}${tag('ram:AccountName', s.accountName || s.name)}</ram:PayeePartyCreditorFinancialAccount>` +
      (String(s.bic || '').trim() ? `<ram:PayeeSpecifiedCreditorFinancialInstitution>${tag('ram:BICID', String(s.bic).replace(/\s+/g, '').toUpperCase())}</ram:PayeeSpecifiedCreditorFinancialInstitution>` : '') +
      '</ram:SpecifiedTradeSettlementPaymentMeans>' +
      c.groups.map(g => '<ram:ApplicableTradeTax>' +
        `<ram:CalculatedAmount>${money(g.tax)}</ram:CalculatedAmount><ram:TypeCode>VAT</ram:TypeCode>` +
        (g.category === 'E' ? tag('ram:ExemptionReason', SMALL_BUSINESS_REASON) : '') +
        `<ram:BasisAmount>${money(g.basis)}</ram:BasisAmount><ram:CategoryCode>${g.category}</ram:CategoryCode>` +
        `<ram:RateApplicablePercent>${trimNum(g.rate, 0, 2)}</ram:RateApplicablePercent></ram:ApplicableTradeTax>`).join('') +
      '<ram:SpecifiedTradePaymentTerms>' + tag('ram:Description', inv.paymentTerms) + dateEl('ram:DueDateDateTime', inv.dueDate) + '</ram:SpecifiedTradePaymentTerms>' +
      '<ram:SpecifiedTradeSettlementHeaderMonetarySummation>' +
      `<ram:LineTotalAmount>${money(c.net)}</ram:LineTotalAmount>` +
      `<ram:TaxBasisTotalAmount>${money(c.net)}</ram:TaxBasisTotalAmount>` +
      `<ram:TaxTotalAmount currencyID="EUR">${money(c.tax)}</ram:TaxTotalAmount>` +
      `<ram:GrandTotalAmount>${money(c.gross)}</ram:GrandTotalAmount>` +
      `<ram:DuePayableAmount>${money(c.gross)}</ram:DuePayableAmount>` +
      '</ram:SpecifiedTradeSettlementHeaderMonetarySummation></ram:ApplicableHeaderTradeSettlement>');
    x.push('</rsm:SupplyChainTradeTransaction>');
    x.push('</rsm:CrossIndustryInvoice>');
    return x.join('\n') + '\n';
  }

  return { calc, validate, buildXml, ibanValid, emailValid, round2, UNITS, SMALL_BUSINESS_REASON };
});
