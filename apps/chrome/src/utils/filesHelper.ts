import type { Conversation } from '@/store/historySlice';
import type { Message } from '@/store/chatSlice';

export function exportJsonArrayToFile(jsonArray: any[], filename: string): void {
  const blob = new Blob([JSON.stringify(jsonArray, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();

  // 清理
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// 验证上传的 JSON 是否符合预期结构
const isValidJsonArray = (data: any): data is Conversation[] => {
  return (
    Array.isArray(data) &&
    data.every(
      (item) =>
        typeof item.lastModel === 'string' &&
        typeof item.lastUpdatedAt === 'number' &&
        Array.isArray(item.messages) &&
        item.messages.every(
          (msg: Message) =>
            typeof msg.content === 'string' &&
            typeof msg.createdAt === 'number' &&
            typeof msg.role === 'string'
        )
    )
  );
};

// 处理上传文件并解析json
export const uploadHistoryMessages = ({
  file,
  onSuccess,
  onValidFailed,
  onError,
}: {
  file: File;
  onSuccess?: any;
  onValidFailed?: any;
  onError?: any;
}) => {
  const reader = new FileReader();

  reader.onload = async (e) => {
    try {
      const content = e.target?.result;
      if (content) {
        const parsedData = JSON.parse(content as string) as Conversation;
        if (isValidJsonArray(parsedData)) {
          const nowTime = Date.now();
          // 读取本地的 historyConversations
          const { historyConversations } = await chrome.storage.local.get('historyConversations');
          parsedData.forEach((item) => (item.exportedAt = nowTime));

          // 将数据追加到本地的 historyConversations
          await chrome.storage.local.set({
            historyConversations: [...historyConversations, ...parsedData].sort(
              (a, b) => b.lastUpdatedAt - a.lastUpdatedAt
            ),
          });

          onSuccess();
        } else {
          onValidFailed();
        }
      }
    } catch (error) {
      onError;
    }
  };

  reader.readAsText(file);
};
