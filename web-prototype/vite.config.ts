import { defineConfig } from "vite";

/**
 * Framilux Web 原型（M1）
 *
 * 离线红线（AGENTS.md #1）：构建产物不得依赖任何 CDN / 远程字体 / 远程 API。
 * 本配置刻意不引入任何需要联网的插件；dev server 只监听回环地址。
 */
export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: 5173,
    // 摄像头 getUserMedia 要求安全上下文：http://127.0.0.1 与 https 等价，勿改成局域网 IP
  },
  build: {
    target: "es2022",
    sourcemap: true,
    // 便于离线打开 dist/index.html 自查
    assetsInlineLimit: 0,
  },
});
