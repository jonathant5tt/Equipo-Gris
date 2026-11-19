/**
 * @file buscador-cliente.js
 * @description Componente <buscador-cliente>: busca clientes por nombre o
 * teléfono y muestra una vista previa mientras se escribe
 * (ej. «hug» → Hugo Garrido Romero, Hugo González Aguilar…).
 * Los clientes con membresía vigente aparecen con letras doradas.
 *
 * Uso:
 *   <buscador-cliente cliente-cero nuevo="registrar-cobro.html"></buscador-cliente>
 *
 * Atributos:
 *   cliente-cero  Muestra primero la opción «Cliente 0» (venta sin datos del cliente).
 *   nuevo         Muestra «Registrar cliente nuevo»; el valor es la pantalla a la
 *                 que se regresa después de registrarlo (nuevo-cliente.html?volver=…).
 *   placeholder   Texto de ayuda del campo.
 *
 * Evento:
 *   «cliente:elegido» con detail = { cliente }  (cliente = null para Cliente 0)
 *
 * Métodos:
 *   limpiar(), enfocar()
 *
 * Requiere: idioma.js, utilidades.js, api.js
 */
(function () {
  'use strict';

  var MINIMO = 2;
  var LIMITE = 8;

  class BuscadorCliente extends HTMLElement {
    connectedCallback() {
      if (this._listo) return;
      this._listo = true;
      var self = this;
      var t = window.Idioma.t;
      var idLista = 'sugerencias-' + Math.random().toString(36).slice(2, 8);

      this.classList.add('buscador');
      this.innerHTML =
        '<div class="campo-icono">' +
          '<span class="icono" aria-hidden="true">search</span>' +
          '<input class="campo" type="search" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="' + idLista + '">' +
        '</div>' +
        '<ul class="sugerencias" id="' + idLista + '" role="listbox" hidden></ul>';

      this.entrada = this.querySelector('input');
      this.lista = this.querySelector('ul');
      this.entrada.placeholder = t(this.getAttribute('placeholder') || 'Nombre o teléfono del cliente');
      this.entrada.setAttribute('aria-label', t('Buscar cliente por nombre o teléfono'));
      this.opciones = [];
      this.activa = -1;
      this.consulta = 0;

      var buscar = window.Utilidades.retrasar(function () { self.buscar(); }, 220);
      this.entrada.addEventListener('input', buscar);
      this.entrada.addEventListener('focus', function () { if (self.entrada.value.trim().length < MINIMO) self.buscar(); });
      this.entrada.addEventListener('keydown', function (e) { self.teclado(e); });
      document.addEventListener('click', function (e) { if (!self.contains(e.target)) self.cerrar(); });
    }

    /** Consulta la API y dibuja la lista. */
    async buscar() {
      var texto = this.entrada.value.trim();
      var numero = ++this.consulta;
      var clientes = [];
      if (texto.length >= MINIMO) {
        try { clientes = (await window.Api.clientes.buscar({ buscar: texto, limite: LIMITE })) || []; }
        catch (error) { window.Utilidades.aviso(error.message, 'error'); }
      }
      if (numero !== this.consulta) return;   // llegó una respuesta más nueva
      this.dibujar(texto, clientes);
    }

    /** Arma las opciones: Cliente 0, coincidencias y «registrar nuevo». */
    dibujar(texto, clientes) {
      var t = window.Idioma.t;
      var U = window.Utilidades;
      this.opciones = [];
      if (this.hasAttribute('cliente-cero')) {
        this.opciones.push({ tipo: 'cero', titulo: t('Cliente 0'), detalle: t('Público en general · sin datos en el ticket') });
      }
      clientes.forEach(function (c) {
        this.opciones.push({
          tipo: 'cliente', cliente: c, titulo: c.Nombre, oro: !!c.MembresiaActiva,
          detalle: U.formatoTelefono(c.Telefono) + (c.MembresiaActiva ? ' · ' + t('Membresía') + ' ' + (c.NombrePlan || '') : '')
        });
      }, this);
      if (texto.length >= MINIMO && !clientes.length) {
        this.opciones.push({ tipo: 'nada', titulo: t('Sin coincidencias para «{texto}»', { texto: texto }) });
      }
      if (this.hasAttribute('nuevo') && (texto.length >= MINIMO || !this.hasAttribute('cliente-cero'))) {
        this.opciones.push({ tipo: 'nuevo', titulo: t('Registrar cliente nuevo'), detalle: texto ? '«' + texto + '»' : '' });
      }

      this.lista.replaceChildren();
      this.opciones.forEach(function (op, i) {
        var li = document.createElement('li');
        li.className = 'sugerencia sugerencia--' + op.tipo + (op.oro ? ' sugerencia--oro' : '');
        li.setAttribute('role', 'option');
        li.id = this.lista.id + '-' + i;
        if (op.tipo === 'cliente') li.setAttribute('translate', 'no');
        var icono = { cero: 'person_off', cliente: op.oro ? 'workspace_premium' : 'person', nada: 'search_off', nuevo: 'person_add' }[op.tipo];
        li.innerHTML = '<span class="icono icono--sm" aria-hidden="true">' + icono + '</span><span class="sugerencia__cuerpo"><span class="sugerencia__titulo"></span><span class="sugerencia__detalle"></span></span>';
        if (op.cliente && op.cliente.FotoCorteReferencia) {
          var foto = document.createElement('img');
          foto.className = 'sugerencia__foto';
          foto.alt = '';
          foto.loading = 'lazy';
          foto.src = window.Utilidades.urlArchivo(op.cliente.FotoCorteReferencia);
          var icono0 = li.querySelector('.icono');
          foto.onerror = function () { foto.replaceWith(icono0); };
          li.replaceChild(foto, icono0);
        }
        li.querySelector('.sugerencia__titulo').textContent = op.titulo;
        li.querySelector('.sugerencia__detalle').textContent = op.detalle || '';
        if (op.tipo !== 'nada') {
          li.addEventListener('mousedown', function (e) { e.preventDefault(); });
          li.addEventListener('click', this.elegir.bind(this, i));
        } else li.setAttribute('aria-disabled', 'true');
        this.lista.appendChild(li);
      }, this);
      this.activa = -1;
      var abierta = this.opciones.length > 0;
      this.lista.hidden = !abierta;
      this.entrada.setAttribute('aria-expanded', String(abierta));
    }

    /** Flechas, Enter y Escape. */
    teclado(e) {
      if (this.lista.hidden) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        var total = this.opciones.length;
        this.activa = (this.activa + (e.key === 'ArrowDown' ? 1 : -1) + total) % total;
        Array.prototype.forEach.call(this.lista.children, function (li, i) { li.classList.toggle('sugerencia--activa', i === this.activa); }, this);
        this.entrada.setAttribute('aria-activedescendant', this.lista.id + '-' + this.activa);
      } else if (e.key === 'Enter' && this.activa >= 0) {
        e.preventDefault();
        this.elegir(this.activa);
      } else if (e.key === 'Escape') {
        this.cerrar();
      }
    }

    /** @param {number} i  Índice de la opción. */
    elegir(i) {
      var op = this.opciones[i];
      if (!op || op.tipo === 'nada') return;
      if (op.tipo === 'nuevo') {
        var volver = this.getAttribute('nuevo') || '';
        var texto = this.entrada.value.trim();
        var parametros = new URLSearchParams();
        if (volver) parametros.set('volver', volver);
        if (texto) parametros.set(/^\d+$/.test(texto) ? 'telefono' : 'nombre', texto);
        window.location.href = 'nuevo-cliente.html?' + parametros.toString();
        return;
      }
      this.entrada.value = op.tipo === 'cero' ? op.titulo : op.cliente.Nombre;
      this.cerrar();
      this.dispatchEvent(new CustomEvent('cliente:elegido', { bubbles: true, detail: { cliente: op.tipo === 'cero' ? null : op.cliente } }));
    }

    cerrar() {
      this.lista.hidden = true;
      this.entrada.setAttribute('aria-expanded', 'false');
    }

    limpiar() { this.entrada.value = ''; this.cerrar(); }

    enfocar() { this.entrada.focus(); }
  }

  if (!customElements.get('buscador-cliente')) customElements.define('buscador-cliente', BuscadorCliente);
})();
