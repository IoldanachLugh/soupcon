import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // vitest (2.x) transforms .jsx itself and defaults to the classic JSX
  // runtime, which needs `React` in scope; the app's build uses the plugin's
  // automatic runtime. This makes the test transform match.
  // (Only in test mode: the real build sets oxc options and warns if esbuild
  // ones are also present.)
  ...(mode === 'test' ? { esbuild: { jsx: 'automatic' } } : {}),
  // Relative base so the same `dist/` output works whether it's deployed
  // under a subpath (public_html/dev, for review) or promoted straight to
  // the public_html root (production) -- no rebuild or per-environment
  // config needed between the two, just copy the same folder to either
  // location.
  base: './',
}))
