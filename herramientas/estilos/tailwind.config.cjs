/**
 * Configuración de Tailwind CSS (CLI) para compilar assets/css/tailwind.css.
 *
 * Tailwind se usa solo para la distribución (grid, flex, espacios, tamaños y
 * puntos de quiebre). Los colores y componentes viven en assets/css/comun.css
 * como variables CSS; aquí se exponen con los mismos nombres para poder usar
 * clases como `text-texto-suave` o `bg-superficie`.
 *
 * Después de agregar clases nuevas en el HTML o el JS, vuelve a compilar:
 *   cd servidor && npm run estilos
 */
const path = require('path');
const raiz = path.join(__dirname, '..', '..');

module.exports = {
  content: [path.join(raiz, '*.html'), path.join(raiz, 'assets/js/**/*.js')],
  ...{
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
}
};
