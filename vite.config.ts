import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Project Pages serves from /<repo>/, so every asset URL needs that prefix.
// BASE_PATH lets the deploy workflow override it without editing this file.
const base = process.env.BASE_PATH ?? '/spymaster-web/';

export default defineConfig({
    plugins: [react()],
    base,
    // Game data lives under public/ so vite copies it into dist untouched and the
    // app can fetch it at BASE_URL + 'data/...'. The sync and snapshot scripts
    // write into the same tree.
    publicDir: 'public',
    test: {
        environment: 'node',
        include: ['src/**/*.test.ts'],
    },
});
