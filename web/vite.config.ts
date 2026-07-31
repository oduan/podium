import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev server proxies API + WebSocket to the Go backend on :38273.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:38273",
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    // The Go server embeds this directory into the final executable.
    outDir: "../server/internal/webui/dist",
    emptyOutDir: true,
  },
});
