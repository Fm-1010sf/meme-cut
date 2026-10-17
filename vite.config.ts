import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // 相对路径：这样同一份产物能放在域名根目录（Cloudflare / Netlify），
  // 也能放在子路径（GitHub Pages 的 /仓库名/），不用为每个平台单独打一次包。
  base: './',
  server: {
    host: true,
    port: 5183,
  },
})
