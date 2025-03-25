import { LogoChromeIcon } from 'tdesign-icons-react';

import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

import LogoIcon from '/logo.svg';

const chromeStoreUrl = 'https://chromewebstore.google.com/detail/ghfkjnjclgfihkfcocbaanohpcjbnjon';

export default function HomePage() {
  return (
    <div className="min-h-screen bg-white">
      {/* 导航栏 */}
      <nav className="flex items-center justify-between px-6 py-4 max-w-7xl mx-auto">
        <div className="flex items-center gap-2">
          <img src={LogoIcon} className="logo" width={30} />
          <span className="text-xl font-bold">对答如流，你的本地 AI 助手</span>
        </div>

        <div className="flex items-center gap-6">
          {/* <a href="#features" className="text-gray-600 hover:text-gray-900">
            功能
          </a>
          <a href="#security" className="text-gray-600 hover:text-gray-900">
            安全
          </a> */}
          <Button
            onClick={() => {
              window.open(chromeStoreUrl, '_blank');
            }}
          >
            <LogoChromeIcon />
            立即下载
          </Button>
        </div>
      </nav>

      {/* 主体内容 */}
      <main className="max-w-7xl mx-auto px-6">
        {/* 首屏 */}
        <section className="py-20 text-center">
          <h1 className="text-5xl font-bold mb-6">侧边栏友好，隐私有界</h1>
          <p className="text-xl text-gray-600 mb-8 max-w-2xl mx-auto">
            对答如流是一款为 Ollama 用户设计，以浏览器侧边栏为主场景
            <br />
            Local-only 的扩展程序。
          </p>
          <div className="flex justify-center gap-4">
            <Button
              className="px-8 py-6 text-lg"
              onClick={() => {
                window.open(chromeStoreUrl, '_blank');
              }}
            >
              免费开始使用
            </Button>
            <Button variant="outline" className="px-8 py-6 text-lg">
              了解更多
            </Button>
          </div>

          {/* 示例图片区域 */}
          <div className="mt-16 border rounded-xl p-2 max-w-4xl mx-auto shadow-lg">
            <img src="/ddrl.png" height="100%" />
          </div>
        </section>

        {/* 功能亮点 */}
        <section id="features" className="py-20">
          <h2 className="text-3xl font-bold text-center mb-12">核心功能</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <Card>
              <CardHeader>
                <svg
                  className="w-12 h-12 mb-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M13 10V3L4 14h7v7l9-11h-7z"
                  />
                </svg>
                <CardTitle>随时唤起</CardTitle>
                <CardDescription>可通过快捷键、右键菜单，应用按钮，随时唤起使用</CardDescription>
              </CardHeader>
            </Card>

            <Card>
              <CardHeader>
                <svg
                  className="w-12 h-12 mb-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                  />
                </svg>
                <CardTitle>本地 AI 助手</CardTitle>
                <CardDescription>方便使用 AI 助手，帮你解答疑问、总结网页要点</CardDescription>
              </CardHeader>
            </Card>

            <Card>
              <CardHeader>
                <svg
                  className="w-12 h-12 mb-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                  />
                </svg>
                <CardTitle>隐私无忧</CardTitle>
                <CardDescription>无任何第三方接口，保障隐私安全</CardDescription>
              </CardHeader>
            </Card>
          </div>
        </section>

        <section className="py-20 bg-gray-50">
          <div className="max-w-4xl mx-auto text-center">
            <h2 className="text-3xl font-bold mb-8">设计理念</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 text-left">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-black rounded-full"></div>
                  <h3 className="font-semibold">多设备同步</h3>
                </div>
                <p className="text-gray-600 text-sm">
                  系统语言、深浅模式、自定义提示词等通过 &nbsp;
                  <a
                    className="underline"
                    href="https://developer.chrome.com/docs/extensions/reference/api/storage#property-sync"
                    target="_blank"
                  >
                    chrome.storage.sync
                  </a>
                  &nbsp; 实现多设备同步
                </p>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-black rounded-full"></div>
                  <h3 className="font-semibold">简明清晰</h3>
                </div>
                <p className="text-gray-600 text-sm">UI设计遵循极简理念，将操作路径压缩至最短。</p>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-black rounded-full"></div>
                  <h3 className="font-semibold">持续更新并开源</h3>
                </div>
                <p className="text-gray-600 text-sm">
                  持续更新中，会持续优化体验，添加功能并保持开源特性
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* 页脚 */}
      <footer className="border-t mt-20">
        <div className="max-w-7xl mx-auto px-6 py-8 flex justify-between text-gray-600">
          <div>© 2025 对答如流.</div>
          {/* <div className="flex gap-6">
            <a href="#" className="hover:text-gray-900">
              隐私政策
            </a>
            <a href="#" className="hover:text-gray-900">
              服务条款
            </a>
          </div> */}
        </div>
      </footer>
    </div>
  );
}
