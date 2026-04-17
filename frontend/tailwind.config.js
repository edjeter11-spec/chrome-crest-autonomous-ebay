/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      colors: {
        f1red: '#E10600',
        f1gold: '#FFD700',
        f1dark: '#0A0A0A',
        f1surface: '#111111',
        f1card: '#1A1A1A',
        f1border: '#2A2A2A',
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.5rem',
      },
    },
  },
  plugins: [],
}
