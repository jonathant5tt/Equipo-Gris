#!/usr/bin/env python3
"""
Genera assets/js/idiomas/en.js e it.js a partir de textos.tsv.

  python3 herramientas/idiomas/generar.py

textos.tsv: una línea por texto «español<TAB>inglés<TAB>italiano».
Los textos con datos variables (nombres, números) se traducen con los
patrones de PATRONES (expresiones regulares de JavaScript).
"""
import json, os, sys
AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(os.path.dirname(AQUI))
SALIDA = os.path.join(RAIZ, 'assets', 'js', 'idiomas')

# ---------------------------------------------------------------------------
# Patrones por idioma (código JavaScript). `T(x)` traduce con el diccionario,
# `H(x)` convierte horas «6:30 p. m.» al formato del idioma.
# ---------------------------------------------------------------------------
COMUN = r'''
  var T = function (x) { var d = window.DICCIONARIOS[IDIOMA].textos; return d[x] !== undefined ? d[x] : (d[x.charAt(0).toUpperCase() + x.slice(1)] || x); };
  var campo = function (c) {
    var m = /^Beneficio (\d+): (.+)$/.exec(c);
    if (m) return T('Beneficio') + ' ' + m[1] + ': ' + T(m[2].charAt(0).toUpperCase() + m[2].slice(1)).toLowerCase();
    return T(c);
  };
  var ESTADOS = { Agendada: 'Agendada', EnEspera: 'En espera', EnAtencion: 'En atención', Atendida: 'Atendida', Cancelada: 'Cancelada', NoAsistio: 'No asistió' };
'''

PATRONES = {
'en': COMUN + r'''
  var H = function (h) { return String(h).replace(/\s*a\.\s*m\./, ' AM').replace(/\s*p\.\s*m\./, ' PM'); };
  var mayus = function (s) { return s.charAt(0).toUpperCase() + s.slice(1); };
  var D = { 'L': 'Mon', 'M': 'Tue', 'X': 'Wed', 'J': 'Thu', 'V': 'Fri', 'S': 'Sat', 'D': 'Sun' };
  return [
    [/^Descuento «(.+)»: ([\d.]+) %$/, 'Discount "$1": $2%'],
    [/^Descuento «(.+)»$/, 'Discount "$1"'],
    [/^(.+) \(Meta (\d+): (.*)\)$/, function (m, a, c, d) { return T(a) + ' (Meta ' + c + ': ' + d + ')'; }],
    [/^No se pudo conectar con la impresora\. Revisa que esté encendida, con papel.*\((.*)\)$/, 'Could not connect to the printer. Check that it is on, has paper, is near the phone, is paired in the Bluetooth settings and is not connected to another phone or computer. ($1)'],
    [/^«(.+)»: solo quedan (\d+) por reembolsar\.$/, '"$1": only $2 left to refund.'],
    [/^«(.+)» ya fue reembolsado\.$/, '"$1" has already been refunded.'],
    [/^Concepto (\d+): no pertenece a esta venta\.$/, 'Item $1: does not belong to this sale.'],
    [/^El horario del (.+) no es válido\.$/, function (m, d) { return 'The hours for ' + T(mayus(d)) + ' are not valid.'; }],
    [/^El (.+) la hora de cierre debe ser después de la de apertura\.$/, function (m, d) { return T(mayus(d)) + ': the closing time must be after the opening time.'; }],
    [/^(.+?) es obligatori[oa]\.$/, function (m, c) { return mayus(campo(c)) + ' is required.'; }],
    [/^(.+?) debe tener al menos (\d+) caracteres\.$/, function (m, c, n) { return mayus(campo(c)) + ' must have at least ' + n + ' characters.'; }],
    [/^(.+?) admite como máximo (\d+) caracteres\.$/, function (m, c, n) { return mayus(campo(c)) + ' allows at most ' + n + ' characters.'; }],
    [/^(.+?) es demasiado larga\.$/, function (m, c) { return mayus(campo(c)) + ' is too long.'; }],
    [/^(.+?) no es una fecha válida\.$/, function (m, c) { return mayus(campo(c)) + ' is not a valid date.'; }],
    [/^(.+?) no es una hora válida\.$/, function (m, c) { return mayus(campo(c)) + ' is not a valid time.'; }],
    [/^(.+?) debe tener 10 dígitos\.$/, function (m, c) { return mayus(campo(c)) + ' must have 10 digits.'; }],
    [/^(.+?): marca al menos un día\.$/, function (m, c) { return mayus(campo(c)) + ': select at least one day.'; }],
    [/^(.+?) no es válid[oa]\.$/, function (m, c) { return mayus(campo(c)) + ' is not valid.'; }],
    [/^Concepto (\d+): cantidad no válida\.$/, 'Item $1: invalid quantity.'],
    [/^Concepto (\d+): el producto no existe\.$/, 'Item $1: the product does not exist.'],
    [/^Concepto (\d+): el servicio no existe\.$/, 'Item $1: the service does not exist.'],
    [/^Concepto (\d+): elige el barbero que realizó el servicio\.$/, 'Item $1: choose the barber who performed the service.'],
    [/^Concepto (\d+): tipo no válido\.$/, 'Item $1: invalid type.'],
    [/^El usuario «(.+)» ya está en uso\. Elige otro\.$/, 'The username "$1" is already taken. Choose another one.'],
    [/^Este barbero tiene (\d+) cita\(s\) próximas\..*$/, 'This barber has $1 upcoming appointment(s). Reschedule or cancel them before deleting the account.'],
    [/^La cita está «(.+)» y no puede pasar a «(.+)»\.$/, function (m, a, b) { return 'The appointment is "' + T(ESTADOS[a] || a) + '" and cannot change to "' + T(ESTADOS[b] || b) + '".'; }],
    [/^No se puede agendar ese día: (.+)\.$/, function (m, x) { return 'Cannot book that day: ' + T(mayus(x)).toLowerCase() + '.'; }],
    [/^Sin existencias suficientes de «(.+)» \(quedan (\d+)\)\.$/, 'Not enough stock of "$1" ($2 left).'],
    [/^Sin existencias suficientes de «(.+)»\.$/, 'Not enough stock of "$1".'],
    [/^Solo hay (\d+) pieza\(s\) de «(.+)»\.$/, 'There are only $1 unit(s) of "$2".'],
    [/^Beneficio (\d+): en «todos los productos» solo se permite un descuento en %\.$/, 'Benefit $1: "all products" only allows a % discount.'],
    [/^Beneficio (\d+): el servicio ya no existe\.$/, 'Benefit $1: the service no longer exists.'],
    [/^Beneficio (\d+): el producto ya no existe\.$/, 'Benefit $1: the product no longer exists.'],
    [/^(.+): gratis \((\d+) de (\d+) por visita\)$/, '$1: free ($2 of $3 per visit)'],
    [/^(.+): ([\d.]+) % de descuento \((\d+) de (\d+) por visita\)$/, '$1: $2% off ($3 of $4 per visit)'],
    [/^(.+): límite por visita alcanzado \((\d+) de (\d+)\)$/, '$1: per-visit limit reached ($2 of $3)'],
    [/^(.+): gratis \(uso (\d+) de (\d+) del mes\)$/, '$1: free (use $2 of $3 this month)'],
    [/^(.+): gratis$/, '$1: free'],
    [/^(.+): ([\d.]+) % de descuento \(uso (\d+) de (\d+) del mes\)$/, '$1: $2% off (use $3 of $4 this month)'],
    [/^(.+): ([\d.]+) % de descuento$/, '$1: $2% off'],
    [/^(.+): límite mensual alcanzado \((\d+) de (\d+)\)$/, '$1: monthly limit reached ($2 of $3)'],
    [/^(.+): ([\d.]+) % en productos$/, '$1: $2% off products'],
    [/^Nueva cita el (\S+) a las (.+): (.+)\.$/, function (m, f, h, s) { return 'New appointment on ' + f + ' at ' + H(h) + ': ' + s + '.'; }],
    [/^(.+) canceló la cita del (\S+) a las (.+)\.$/, function (m, c, f, h) { return c + ' cancelled the appointment on ' + f + ' at ' + H(h) + '.'; }],
    [/^Tu horario ahora es de (.+) a (.+), días (.+)\.$/, function (m, a, b, d) { return 'Your schedule is now ' + H(a) + ' to ' + H(b) + ', days ' + d.split(',').map(function (x) { return D[x.trim()] || x; }).join(', ') + '.'; }],
    [/^Corte del (.+)$/, 'Haircut $1'],
    [/^(\d+) tickets?$/, function (m, n) { return n + (n === '1' ? ' receipt' : ' receipts'); }]
  ];
''',
'it': COMUN + r'''
  var H = function (h) {
    var m = /(\d{1,2}):(\d{2})\s*([ap])\.\s*m\./.exec(String(h));
    if (!m) return h;
    var hh = Number(m[1]) % 12 + (m[3] === 'p' ? 12 : 0);
    return String(hh).padStart(2, '0') + ':' + m[2];
  };
  var mayus = function (s) { return s.charAt(0).toUpperCase() + s.slice(1); };
  var D = { 'L': 'Lun', 'M': 'Mar', 'X': 'Mer', 'J': 'Gio', 'V': 'Ven', 'S': 'Sab', 'D': 'Dom' };
  return [
    [/^Descuento «(.+)»: ([\d.]+) %$/, 'Sconto «$1»: $2 %'],
    [/^Descuento «(.+)»$/, 'Sconto «$1»'],
    [/^(.+) \(Meta (\d+): (.*)\)$/, function (m, a, c, d) { return T(a) + ' (Meta ' + c + ': ' + d + ')'; }],
    [/^No se pudo conectar con la impresora\. Revisa que esté encendida, con papel.*\((.*)\)$/, 'Impossibile collegarsi alla stampante. Verifica che sia accesa, con carta, vicina al telefono, associata nelle impostazioni Bluetooth e non collegata a un altro telefono o computer. ($1)'],
    [/^«(.+)»: solo quedan (\d+) por reembolsar\.$/, '«$1»: ne restano solo $2 da rimborsare.'],
    [/^«(.+)» ya fue reembolsado\.$/, '«$1» è già stato rimborsato.'],
    [/^Concepto (\d+): no pertenece a esta venta\.$/, 'Voce $1: non appartiene a questa vendita.'],
    [/^El horario del (.+) no es válido\.$/, function (m, d) { return "L'orario di " + T(mayus(d)) + ' non è valido.'; }],
    [/^El (.+) la hora de cierre debe ser después de la de apertura\.$/, function (m, d) { return T(mayus(d)) + ": l'ora di chiusura deve essere dopo quella di apertura."; }],
    [/^(.+?) es obligatori[oa]\.$/, function (m, c) { return mayus(campo(c)) + ': campo obbligatorio.'; }],
    [/^(.+?) debe tener al menos (\d+) caracteres\.$/, function (m, c, n) { return mayus(campo(c)) + ': almeno ' + n + ' caratteri.'; }],
    [/^(.+?) admite como máximo (\d+) caracteres\.$/, function (m, c, n) { return mayus(campo(c)) + ': massimo ' + n + ' caratteri.'; }],
    [/^(.+?) es demasiado larga\.$/, function (m, c) { return mayus(campo(c)) + ': troppo lunga.'; }],
    [/^(.+?) no es una fecha válida\.$/, function (m, c) { return mayus(campo(c)) + ': data non valida.'; }],
    [/^(.+?) no es una hora válida\.$/, function (m, c) { return mayus(campo(c)) + ': ora non valida.'; }],
    [/^(.+?) debe tener 10 dígitos\.$/, function (m, c) { return mayus(campo(c)) + ': deve avere 10 cifre.'; }],
    [/^(.+?): marca al menos un día\.$/, function (m, c) { return mayus(campo(c)) + ': seleziona almeno un giorno.'; }],
    [/^(.+?) no es válid[oa]\.$/, function (m, c) { return mayus(campo(c)) + ': valore non valido.'; }],
    [/^Concepto (\d+): cantidad no válida\.$/, 'Voce $1: quantità non valida.'],
    [/^Concepto (\d+): el producto no existe\.$/, 'Voce $1: il prodotto non esiste.'],
    [/^Concepto (\d+): el servicio no existe\.$/, 'Voce $1: il servizio non esiste.'],
    [/^Concepto (\d+): elige el barbero que realizó el servicio\.$/, 'Voce $1: scegli il barbiere che ha eseguito il servizio.'],
    [/^Concepto (\d+): tipo no válido\.$/, 'Voce $1: tipo non valido.'],
    [/^El usuario «(.+)» ya está en uso\. Elige otro\.$/, 'L\'utente «$1» è già in uso. Scegline un altro.'],
    [/^Este barbero tiene (\d+) cita\(s\) próximas\..*$/, 'Questo barbiere ha $1 appuntamento/i in arrivo. Riprogrammali o annullali prima di eliminare l\'account.'],
    [/^La cita está «(.+)» y no puede pasar a «(.+)»\.$/, function (m, a, b) { return 'L\'appuntamento è «' + T(ESTADOS[a] || a) + '» e non può passare a «' + T(ESTADOS[b] || b) + '».'; }],
    [/^No se puede agendar ese día: (.+)\.$/, function (m, x) { return 'Impossibile prenotare quel giorno: ' + T(mayus(x)).toLowerCase() + '.'; }],
    [/^Sin existencias suficientes de «(.+)» \(quedan (\d+)\)\.$/, 'Giacenza insufficiente di «$1» (restano $2).'],
    [/^Sin existencias suficientes de «(.+)»\.$/, 'Giacenza insufficiente di «$1».'],
    [/^Solo hay (\d+) pieza\(s\) de «(.+)»\.$/, 'Ci sono solo $1 pezzi di «$2».'],
    [/^Beneficio (\d+): en «todos los productos» solo se permite un descuento en %\.$/, 'Vantaggio $1: «tutti i prodotti» ammette solo uno sconto in %.'],
    [/^Beneficio (\d+): el servicio ya no existe\.$/, 'Vantaggio $1: il servizio non esiste più.'],
    [/^Beneficio (\d+): el producto ya no existe\.$/, 'Vantaggio $1: il prodotto non esiste più.'],
    [/^(.+): gratis \((\d+) de (\d+) por visita\)$/, '$1: gratis ($2 di $3 per visita)'],
    [/^(.+): ([\d.]+) % de descuento \((\d+) de (\d+) por visita\)$/, '$1: $2% di sconto ($3 di $4 per visita)'],
    [/^(.+): límite por visita alcanzado \((\d+) de (\d+)\)$/, '$1: limite per visita raggiunto ($2 di $3)'],
    [/^(.+): gratis \(uso (\d+) de (\d+) del mes\)$/, '$1: gratis (uso $2 di $3 del mese)'],
    [/^(.+): gratis$/, '$1: gratis'],
    [/^(.+): ([\d.]+) % de descuento \(uso (\d+) de (\d+) del mes\)$/, '$1: $2% di sconto (uso $3 di $4 del mese)'],
    [/^(.+): ([\d.]+) % de descuento$/, '$1: $2% di sconto'],
    [/^(.+): límite mensual alcanzado \((\d+) de (\d+)\)$/, '$1: limite mensile raggiunto ($2 di $3)'],
    [/^(.+): ([\d.]+) % en productos$/, '$1: $2% sui prodotti'],
    [/^Nueva cita el (\S+) a las (.+): (.+)\.$/, function (m, f, h, s) { return 'Nuovo appuntamento il ' + f + ' alle ' + H(h) + ': ' + s + '.'; }],
    [/^(.+) canceló la cita del (\S+) a las (.+)\.$/, function (m, c, f, h) { return c + ' ha annullato l\'appuntamento del ' + f + ' alle ' + H(h) + '.'; }],
    [/^Tu horario ahora es de (.+) a (.+), días (.+)\.$/, function (m, a, b, d) { return 'Il tuo orario ora è dalle ' + H(a) + ' alle ' + H(b) + ', giorni ' + d.split(',').map(function (x) { return D[x.trim()] || x; }).join(', ') + '.'; }],
    [/^Corte del (.+)$/, 'Taglio del $1'],
    [/^(\d+) tickets?$/, function (m, n) { return n + (n === '1' ? ' scontrino' : ' scontrini'); }]
  ];
'''
}

NOMBRES = {'en': 'inglés', 'it': 'italiano'}


def leer():
    filas = []
    ruta = os.path.join(AQUI, 'textos.tsv')
    for n, linea in enumerate(open(ruta, encoding='utf8'), 1):
        linea = linea.rstrip('\n')
        if not linea.strip() or linea.startswith('#'):
            continue
        partes = linea.split('\t')
        if len(partes) != 3:
            sys.exit(f'textos.tsv línea {n}: se esperaban 3 columnas separadas por TAB')
        filas.append(partes)
    return filas


def main():
    filas = leer()
    for i, codigo in enumerate(['en', 'it'], start=1):
        textos = {}
        for f in filas:
            if f[0] in textos and textos[f[0]] != f[i]:
                print(f'Aviso: «{f[0]}» repetido con otra traducción ({codigo}); se usa la primera.')
                continue
            textos[f[0]] = f[i]
        js = (
            '/**\n'
            f' * @file idiomas/{codigo}.js\n'
            f' * @description Diccionario español → {NOMBRES[codigo]}. ARCHIVO GENERADO:\n'
            ' * edita herramientas/idiomas/textos.tsv y ejecuta\n'
            ' *   python3 herramientas/idiomas/generar.py\n'
            ' */\n'
            '(function () {\n'
            "  'use strict';\n"
            f"  var IDIOMA = '{codigo}';\n"
            '  window.DICCIONARIOS = window.DICCIONARIOS || {};\n'
            '  window.DICCIONARIOS[IDIOMA] = { textos: ' +
            json.dumps(textos, ensure_ascii=False, indent=4).replace('\n', '\n  ') +
            ', patrones: [] };\n'
            '  window.DICCIONARIOS[IDIOMA].patrones = (function () {' + PATRONES[codigo] + '  })();\n'
            '})();\n'
        )
        os.makedirs(SALIDA, exist_ok=True)
        open(os.path.join(SALIDA, codigo + '.js'), 'w', encoding='utf8').write(js)
        print(f'{codigo}.js: {len(textos)} textos')


if __name__ == '__main__':
    main()
