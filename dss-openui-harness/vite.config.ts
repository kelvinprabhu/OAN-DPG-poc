import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ""), ...process.env };
  // /v1 goes to the DSS under test; /scenarios and /health always come from the mock.
  const dss = env.DSS_BASE_URL ?? "http://localhost:8787";
  const mock = env.MOCK_URL ?? "http://localhost:8787";
  return {
    plugins: [react()],
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        "/v1": { target: dss, changeOrigin: true },
        "/scenarios": { target: mock, changeOrigin: true },
        "/health": { target: mock, changeOrigin: true },
      },
    },
  };
});
