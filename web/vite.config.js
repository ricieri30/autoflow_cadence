import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Em desenvolvimento, faz proxy de /api para a API local (porta 4000 na stack
// isolada, 3000 na produção). Em produção quem faz o proxy é o nginx.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 4025,
    proxy: {
      "/api": { target: process.env.API_URL || "http://localhost:4000", changeOrigin: true },
    },
  },
  build: { outDir: "dist", sourcemap: false },
});
