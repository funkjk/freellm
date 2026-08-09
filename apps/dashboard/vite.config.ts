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
    // Do not read PORT — that env is reserved for the gateway (.env PORT=5180).
    port: Number.parseInt(process.env.DASHBOARD_PORT ?? "5181", 10),
    host: "0.0.0.0",
    proxy: {
      // Prefer 127.0.0.1 over localhost: on Windows, localhost often resolves to
      // ::1 first, and another process (e.g. Docker) may own IPv6 :5180 while
      // the gateway listens on 0.0.0.0:5180 (IPv4 only).
      "/api": {
        target: "http://127.0.0.1:5180",
        changeOrigin: true,
      },
    },
  },
});
