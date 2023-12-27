import { Index } from 'solid-js'
import MessageItem from '@/components/MessageItem'
import ErrorMessageItem from '@/components/ErrorMessageItem'
import type { ErrorMessage } from '@/types'
import type { Accessor } from 'solid-js'

interface ParamsType {
  messageGeminiList: Accessor<any[]>
  messageChatgptList: Accessor<any[]>
  retryLastFetch: () => void
  retryLastChatgptFetch: () => void
  currentGeminiAssistantMessage: Accessor<string>
  currentChatgptAssistantMessage: Accessor<string>
  currentChatgptError: Accessor<ErrorMessage>
  currentGeminiError: Accessor<ErrorMessage>
}

export default (params: ParamsType) => {
  const {
    currentGeminiError, messageChatgptList, messageGeminiList,
    retryLastFetch, currentGeminiAssistantMessage, currentChatgptError,
    currentChatgptAssistantMessage, retryLastChatgptFetch,
  } = params
  return (
    <div
      class="message-box"
    >
      <div class="message-item">
        <Index each={messageGeminiList()}>
          {(message, index) => (
            <MessageItem
              role={message().role}
              message={message().content}
              showRetry={() => (message().role === 'assistant' && index === messageGeminiList().length - 1)}
              onRetry={retryLastFetch}
            />
          )}
        </Index>
        {currentGeminiAssistantMessage() && (
          <MessageItem
            role="assistant"
            message={currentGeminiAssistantMessage}
          />
        )}
        {currentGeminiError() && <ErrorMessageItem data={currentGeminiError()} onRetry={retryLastFetch} />}
      </div>

      <div class="message-item">
        <Index each={messageChatgptList()}>
          {(message, index) => (
            <MessageItem
              role={message().role}
              message={message().content}
              showRetry={() => (message().role === 'assistant' && index === messageChatgptList().length - 1)}
              onRetry={retryLastFetch}
            />
          )}
        </Index>
        {currentChatgptAssistantMessage() && (
          <MessageItem
            role="assistant"
            message={currentChatgptAssistantMessage}
          />
        )}
        {currentChatgptError() && <ErrorMessageItem data={currentChatgptError()} onRetry={retryLastChatgptFetch} />}
      </div>
    </div>

  )
}
