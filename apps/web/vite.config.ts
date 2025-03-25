import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'path';
import tailwindcss from '@tailwindcss/vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  css: {
    preprocessorOptions: {
      less: {
        // 全局变量、混入等配置
        modifyVars: {
          'primary-color': '#1890ff', // 示例：自定义 Ant Design 主题色
        },
        javascriptEnabled: true, // 允许 Less JavaScript 代码（某些库需要）
      },
    },
  },
});
