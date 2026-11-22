import { MessageOutlined } from '@ant-design/icons';

// 侧边栏消息渲染，带系统提示词的消息，添加对应的 icon
export const contentWithPromptTag = (systemPrompt: string, userContent: string) => {
  void systemPrompt;
  return (
    <span>
      <MessageOutlined /> {userContent}
    </span>
  );
};
