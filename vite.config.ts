import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      host: '127.0.0.1', // TRAVA APENAS NO SEU PC
      port: 3000,        // FORÇA A PORTA PADRÃO
      strictPort: true   // SE ESTIVER OCUPADA, DÁ ERRO EM VEZ DE MUDAR

    },
  };
});
