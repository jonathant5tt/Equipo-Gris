/**
 * @file tailwind.config.js
 * @description Configuración compartida de Tailwind CSS para todas las pantallas.
 *
 * Tailwind se usa solo para la distribución (grid, flex, espacios, tamaños y
 * puntos de quiebre). Los colores y componentes viven en assets/css/comun.css
 * como variables CSS; aquí se exponen con los mismos nombres para poder usar
 * clases como `text-texto-suave` o `bg-superficie` cuando haga falta.
 *
 * Se carga justo después del script del CDN de Tailwind:
 *   <script src="https://cdn.tailwindcss.com/3.4.17"></script>
 *   <script src="assets/js/tailwind.config.js"></script>
 *
 * Producción: en lugar del CDN, compilar con Tailwind CLI usando este mismo
 * objeto (ver README.md, sección «Compilar estilos para producción»).
 */
/* global tailwind */
tailwind.config = {
  theme: {
    extend: {
      colors: {
        fondo: 'var(--color-fondo)',
        superficie: {
          DEFAULT: 'var(--color-superficie)',
          baja: 'var(--color-superficie-baja)',
          alta: 'var(--color-superficie-alta)'
        },
        borde: 'var(--color-borde)',
        texto: {
          DEFAULT: 'var(--color-texto)',
          suave: 'var(--color-texto-suave)',
          tenue: 'var(--color-texto-tenue)'
        },
        oro: {
          DEFAULT: 'var(--color-oro)',
          claro: 'var(--color-oro-claro)'
        }
      },
      fontFamily: {
        logo: ['"Cormorant Garamond"', 'Georgia', 'serif'],
        titulo: ['"Playfair Display"', 'Georgia', 'serif'],
        sans: ['"Plus Jakarta Sans"', '"Segoe UI"', 'Roboto', 'system-ui', 'sans-serif'],
        numeros: ['Inter', '"Segoe UI"', 'Roboto', 'system-ui', 'sans-serif']
      }
    }
  }
};
