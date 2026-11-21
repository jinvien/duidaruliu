import { isChatImage } from '@/utils/chatImage';

import type { Conversation } from '@/store/historySlice';

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
const isValidStoredMessage = (msg: unknown): boolean => {
  if (!msg || typeof msg !== 'object') return false;
  const value = msg as Record<string, unknown>;
  if (typeof value.content !== 'string') return false;
  if (typeof value.createdAt !== 'number') return false;
  if (typeof value.role !== 'string') return false;
  if (value.images === undefined) return true;
  return Array.isArray(value.images) && value.images.every(isChatImage);
};

const isValidJsonArray = (data: unknown): data is Conversation[] => {
  return (
    Array.isArray(data) &&
    data.every(
      (item) =>
        !!item &&
        typeof item === 'object' &&
        typeof (item as Conversation).lastModel === 'string' &&
        typeof (item as Conversation).lastUpdatedAt === 'number' &&
        Array.isArray((item as Conversation).messages) &&
        (item as Conversation).messages.every(isValidStoredMessage)
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
