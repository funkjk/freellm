import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port: Number.parseInt(process.env.PORT ?? "5173", 10),
    host: "0.0.0.0",
    proxy: {
      // Prefer 127.0.0.1 over localhost: on Windows, localhost often resolves to
      // ::1 first, and another process (e.g. Docker) may own IPv6 :3000 while
      // the gateway listens on 0.0.0.0:3000 (IPv4 only).
      "/api": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
      },
    },
  },
});
