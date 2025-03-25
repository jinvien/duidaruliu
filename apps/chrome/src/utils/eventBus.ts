type MessageListener = (
  message: any,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: any) => void
) => void;

export class EventBus {
  private listeners: Set<MessageListener> = new Set();

  // 添加监听器
  addListener(listener: MessageListener): void {
    if (!this.listeners.has(listener)) {
      this.listeners.add(listener);
      chrome.runtime.onMessage.addListener(listener);
    }
  }

  // 移除监听器
  removeListener(listener: MessageListener): void {
    if (this.listeners.has(listener)) {
      this.listeners.delete(listener);
      // Chrome API 没有直接提供移除监听器的功能，因此要手动管理
      // 这里可以选择自己手动移除监听器（但需要自己保存引用）
    }
  }

  // 清空所有监听器
  clearListeners(): void {
    this.listeners.forEach((listener) => chrome.runtime.onMessage.removeListener(listener));
    this.listeners.clear();
  }
}
