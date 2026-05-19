import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, host: true, strictPort: true },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        demoWebsiteCrm: resolve(__dirname, "demo website crm/index.html"),
      }
    }
  }
});
