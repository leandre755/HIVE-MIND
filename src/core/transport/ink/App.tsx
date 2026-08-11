import React, { useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import { collapseMessages, type Message } from '../../../utils/collapseReadSearch.js';

interface AppProps {
  onMessage: (text: string) => void;
  messages: Message[];
  isTyping?: boolean;
}

export const App: React.FC<AppProps> = ({ onMessage, messages, isTyping }) => {
  const [input, setInput] = useState('');

  const handleSubmit = () => {
    if (!input.trim()) return;
    const text = input;
    setInput('');
    onMessage(text);
  };

  const renderedMessages = collapseMessages(messages);

  return (
    <Box flexDirection="column" padding={1}>
      <Box flexDirection="column" marginBottom={1}>
        {renderedMessages.map((msg) => (
          <Box key={msg.id} flexDirection="row">
            <Text color={msg.sender === 'user' ? 'blue' : 'green'} bold>
              {msg.sender === 'user' ? 'YOU > ' : 'HIVE-MIND > '}
            </Text>
            <Text>{msg.text}</Text>
          </Box>
        ))}
      </Box>

      {isTyping && (
        <Box marginBottom={1}>
          <Text color="gray" italic>
            HIVE-MIND is typing...
          </Text>
        </Box>
      )}

      <Box>
        <Text color="cyan" bold>
          YOU {'>'}{' '}
        </Text>
        <TextInput value={input} onChange={setInput} onSubmit={handleSubmit} />
      </Box>
    </Box>
  );
};
