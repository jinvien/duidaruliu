import { createContext, useContext, useEffect, useState } from 'react';

import type { ChatLayout } from '../host';

const ChatLayoutContext = createContext<ChatLayout>('compact');

export function ChatLayoutProvider({
  layout,
  children,
}: {
  layout: ChatLayout;
  children: React.ReactNode;
}) {
  return <ChatLayoutContext.Provider value={layout}>{children}</ChatLayoutContext.Provider>;
}

export function useChatLayout(): ChatLayout {
  return useContext(ChatLayoutContext);
}

export function useMinWidth(width: number): boolean {
  const query = `(min-width: ${width}px)`;
  const [matches, setMatches] = useState(() =>
    typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(query);
    const onChange = () => setMatches(media.matches);
    onChange();
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}
