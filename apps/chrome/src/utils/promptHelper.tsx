import { Filter3Icon } from 'tdesign-icons-react';

// 侧边栏消息渲染，带系统提示词的消息，添加对应的 icon
export const contentWithPromptTag = (systemPrompt: string, userContent: string) => {
  return (
    <span>
      <Filter3Icon style={{ marginTop: -3 }} /> {userContent}
    </span>
  );
};
