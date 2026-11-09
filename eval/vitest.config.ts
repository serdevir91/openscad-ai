import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { include: ['eval/*.eval.ts'], testTimeout: 0, hookTimeout: 0, reporters: ['dot'] } });
