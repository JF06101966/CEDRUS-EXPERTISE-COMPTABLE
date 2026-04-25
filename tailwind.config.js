/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./*.html",
    "./assets/**/*.{js,css}"
  ],
  theme: {
    extend: {
      colors: {
        'cedrus': {
          600: '#3E9364',
          500: '#4FA36F',
          200: '#BFE6AE'
        },
        'ink': '#0B1420',
        'muted': '#6B7280',
        'paper': '#F8FAF9'
      },
      fontFamily: {
        'playfair': ['Playfair Display', 'serif'],
        'inter': ['Inter', 'sans-serif']
      },
      animation: {
        'fade-in-up': 'fadeInUp 0.6s ease-out forwards',
      },
      keyframes: {
        fadeInUp: {
          '0%': {
            opacity: '0',
            transform: 'translateY(30px)'
          },
          '100%': {
            opacity: '1',
            transform: 'translateY(0)'
          }
        }
      }
    },
  },
  plugins: [],
} 