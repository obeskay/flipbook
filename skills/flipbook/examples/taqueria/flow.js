// Un pedido en la taquería. Estado: si ya pediste, si ya pagaste, si tienes los tacos en la mano,
// cuántos tacos quedan en el trompo y si ya te devolvieron el dinero.
window.FLOW = Flipbook.defineFlow({
  name: 'taquería',
  init: { pedido: false, pagado: false, mano: false, trompo: 2, devuelto: false },
  final: s => s.mano || s.devuelto,
  steps: {
    Pides: { label: 'pides', when: s => !s.pedido, do: s => ({ ...s, pedido: true }) },
    SeAcabaElPastor: {
      label: 'se acaba',
      when: s => s.pedido && !s.pagado && s.trompo > 0,
      do: s => ({ ...s, trompo: 0 })
    },
    // Bug on purpose: nothing here looks at the trompo, so you can pay for tacos that no longer exist.
    Pagas: { label: 'pagas', when: s => s.pedido && !s.pagado && !s.devuelto, do: s => ({ ...s, pagado: true }) },
    TeSirven: {
      label: 'te sirven',
      when: s => s.pagado && !s.mano && s.trompo > 0,
      do: s => ({ ...s, mano: true, trompo: s.trompo - 1 })
    },
    TeDevuelven: {
      label: 'te devuelven el dinero',
      when: s => s.pagado && !s.mano && s.trompo === 0,
      do: s => ({ ...s, pagado: false, devuelto: true })
    }
  },
  rules: {
    NuncaCobrarSinTacos: {
      label: 'nunca te cobran sin tacos',
      ok: s => !(s.pagado && !s.mano && s.trompo === 0),
      expectBroken: true
    }
  },
  view: s => (s.devuelto ? 'te vas sin tacos'
    : s.mano ? 'en tu mano'
    : s.pagado ? (s.trompo === 0 ? 'pagaste sin tacos' : 'pagaste')
    : s.pedido ? (s.trompo === 0 ? 'ya no hay pastor' : 'pediste')
    : 'en la fila')
});
