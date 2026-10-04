import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    name: 'web',
    root: import.meta.dirname,
    environment: 'happy-dom',
    include: ['test/**/*.test.tsx', 'test/**/*.test.ts'],
  },
});
