import { Show, createEffect, createSignal, onCleanup, onMount } from 'solid-js'
import { useThrottleFn } from 'solidjs-use'
import { generateSignature } from '@/utils/auth'
import MessageInput from '@/components/MessageInput'
import IconClear from './icons/Clear'
import type { ChatMessage, ErrorMessage } from '@/types'

export default () => {
  let inputRef: HTMLTextAreaElement
  const [messageGeminiList, setMessageGeminiList] = createSignal<any[]>([])
  const [messageChatgptList, setMessageChatgptList] = createSignal<any[]>([])

  const [currentGeminiError, setCurrentGeminiError] = createSignal<ErrorMessage>()
  const [currentChatgptError, setCurrentChatgptError] = createSignal<ErrorMessage>()

  const [currentGeminiAssistantMessage, setCurrentGeminiAssistantMessage] = createSignal('')

  const [currentChatgptAssistantMessage, setCurrentChatgptAssistantMessage] = createSignal('')

  const [loading, setLoading] = createSignal(false)
  const [controller, setController] = createSignal<AbortController>(null)
  const [isStick, setStick] = createSignal(false)
  const maxHistoryMessages = parseInt(import.meta.env.PUBLIC_MAX_HISTORY_MESSAGES || '99')

  createEffect(() => (isStick() && smoothToBottom()))

  onMount(() => {
    let lastPostion = window.scrollY

    window.addEventListener('scroll', () => {
      const nowPostion = window.scrollY
      nowPostion < lastPostion && setStick(false)
      lastPostion = nowPostion
    })

    try {
      if (localStorage.getItem('messageGeminiList'))
        setMessageGeminiList(JSON.parse(localStorage.getItem('messageGeminiList')))

      if (localStorage.getItem('messageChatgptList'))
        setMessageChatgptList(JSON.parse(localStorage.getItem('messageChatgptList')))

      if (localStorage.getItem('stickToBottom') === 'stick')
        setStick(true)
    } catch (err) {
      console.error(err)
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    onCleanup(() => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
    })
  })

  const handleBeforeUnload = () => {
    localStorage.setItem('messageGeminiList', JSON.stringify(messageGeminiList()))
    localStorage.setItem('messageChatgptList', JSON.stringify(messageChatgptList()))
    isStick() ? localStorage.setItem('stickToBottom', 'stick') : localStorage.removeItem('stickToBottom')
  }

  const handleButtonClick = async() => {
    const inputValue = inputRef.value
    if (!inputValue)
      return

    inputRef.value = ''
    setMessageGeminiList([
      ...(messageGeminiList()),
      {
        role: 'user',
        content: inputValue,
      },
    ])

    setMessageChatgptList([
      ...(messageChatgptList()),
      {
        role: 'user',
        content: inputValue,
      },
    ])

    await Promise.all([
      requestWithLatestGeminiMessage(),
      requestWithLatestChatgptMessage(),
    ])
    instantToBottom()
  }

  const smoothToBottom = useThrottleFn(() => {
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })
  }, 300, false, true)

  const instantToBottom = () => {
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' })
  }

  // ? Interim Solution
  // ensure that the user and the model have a one-to-one conversation and avoid any errors like:
  // "Please ensure that multiturn requests ends with a user role or a function response."
  // convert the raw list into data that conforms to the interface api rules
  const convertReqMsgList = (originalMsgList: ChatMessage[]) => {
    return originalMsgList.filter((curMsg, i, arr) => {
      // Check if there is a next message
      const nextMsg = arr[i + 1]
      // Include the current message if there is no next message or if the roles are different
      return !nextMsg || curMsg.role !== nextMsg.role
    })
  }

  const requestWithLatestChatgptMessage = async() => {
    setLoading(true)
    setCurrentChatgptAssistantMessage('')
    setCurrentChatgptError(null)

    const storagePassword = localStorage.getItem('pass')

    try {
      const controller = new AbortController()
      setController(controller)
      const requestChatgptMessageList = messageChatgptList().slice(-maxHistoryMessages)

      const timestamp = Date.now()
      const chatgpt_response = await fetch('/api/generate_chatgpt', {
        method: 'POST',
        body: JSON.stringify({
          messages: convertReqMsgList(requestChatgptMessageList as ChatMessage[]),
          time: timestamp,
          pass: storagePassword,
          sign: await generateSignature({
            t: timestamp,
            m: requestChatgptMessageList?.[requestChatgptMessageList.length - 1]?.content || '',
          }),
        }),
        signal: controller.signal,
      })

      if (!chatgpt_response.ok) {
        const error = await chatgpt_response.json()
        console.error(error.error)
        setCurrentChatgptError(error.error)
        throw new Error('Request failed')
      }
      const data = chatgpt_response.body
      if (!data)
        throw new Error('No data')

      const reader = data.getReader()
      const decoder = new TextDecoder('utf-8')
      let done = false

      while (!done) {
        const { value, done: readerDone } = await reader.read()
        if (value) {
          const char = decoder.decode(value, { stream: true })
          if (char === '\n' && currentChatgptAssistantMessage().endsWith('\n'))
            continue

          if (char)
            setCurrentChatgptAssistantMessage(currentChatgptAssistantMessage() + char)

          isStick() && instantToBottom()
        }
        done = readerDone
      }
      if (done)
        setCurrentChatgptAssistantMessage(currentChatgptAssistantMessage() + decoder.decode())
    } catch (e) {
      console.error(e)
      setLoading(false)
      setController(null)
      return
    }
    archiveCurrentChatgptMessage()
    isStick() && instantToBottom()
  }

  const requestWithLatestGeminiMessage = async() => {
    setLoading(true)
    setCurrentGeminiAssistantMessage('')
    setCurrentGeminiError(null)
    const storagePassword = localStorage.getItem('pass')
    try {
      const controller = new AbortController()
      setController(controller)

      const requestGeminiMessageList = messageGeminiList().map(message => ({
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: message.content }],
        content: message.content,
      })).slice(-maxHistoryMessages)

      const timestamp = Date.now()
      const gemini_response = await fetch('/api/generate', {
        method: 'POST',
        body: JSON.stringify({
          messages: requestGeminiMessageList,
          time: timestamp,
          pass: storagePassword,
          sign: await generateSignature({
            t: timestamp,
            m: requestGeminiMessageList?.[requestGeminiMessageList.length - 1]?.parts[0]?.text || '',
          }),
        }),
        signal: controller.signal,
      })

      if (!gemini_response.ok) {
        const error = await gemini_response.json()
        console.error(error.error)
        setCurrentGeminiError(error.error)
        throw new Error('Request failed')
      }
      const data = gemini_response.body
      if (!data)
        throw new Error('No data')

      const reader = data.getReader()
      const decoder = new TextDecoder('utf-8')
      let done = false

      while (!done) {
        const { value, done: readerDone } = await reader.read()
        if (value) {
          const char = decoder.decode(value, { stream: true })
          if (char === '\n' && currentGeminiAssistantMessage().endsWith('\n'))
            continue

          if (char)
            setCurrentGeminiAssistantMessage(currentGeminiAssistantMessage() + char)

          isStick() && instantToBottom()
        }
        done = readerDone
      }
      if (done)
        setCurrentGeminiAssistantMessage(currentGeminiAssistantMessage() + decoder.decode())
    } catch (e) {
      console.error(e)
      setLoading(false)
      setController(null)
      return
    }
    archiveCurrentGeminiMessage()
    isStick() && instantToBottom()
  }

  const archiveCurrentChatgptMessage = () => {
    if (currentChatgptAssistantMessage()) {
      setMessageChatgptList([
        ...messageChatgptList(),
        {
          role: 'assistant',
          content: currentChatgptAssistantMessage(),
        },
      ])

      setCurrentChatgptAssistantMessage('')
      setLoading(false)
      setController(null)
      // Disable auto-focus on touch devices
      if (!('ontouchstart' in document.documentElement || navigator.maxTouchPoints > 0))
        inputRef.focus()
    }
  }

  const archiveCurrentGeminiMessage = () => {
    if (currentGeminiAssistantMessage()) {
      setMessageGeminiList([
        ...messageGeminiList(),
        {
          role: 'assistant',
          content: currentGeminiAssistantMessage(),
        },
      ])

      setCurrentGeminiAssistantMessage('')
      setLoading(false)
      setController(null)
      // Disable auto-focus on touch devices
      if (!('ontouchstart' in document.documentElement || navigator.maxTouchPoints > 0))
        inputRef.focus()
    }
  }

  const clear = () => {
    inputRef.value = ''
    inputRef.style.height = 'auto'
    setMessageGeminiList([])
    setMessageChatgptList([])
    setCurrentGeminiAssistantMessage('')
    setCurrentChatgptAssistantMessage('')
    setCurrentGeminiError(null)
  }

  const stopStreamFetch = () => {
    if (controller()) {
      controller().abort()
      archiveCurrentGeminiMessage()
      archiveCurrentChatgptMessage()
    }
  }

  const retryLastGeminiFetch = () => {
    if (messageGeminiList().length > 0) {
      const lastMessage = messageGeminiList()[messageGeminiList().length - 1]
      if (lastMessage.role === 'assistant')
        setMessageGeminiList(messageGeminiList().slice(0, -1))
      requestWithLatestGeminiMessage()
    }
  }

  const retryLastChatgptFetch = () => {
    if (messageChatgptList().length > 0) {
      const lastMessage = messageChatgptList()[messageChatgptList().length - 1]
      if (lastMessage.role === 'assistant')
        setMessageChatgptList(messageChatgptList().slice(0, -1))
      requestWithLatestChatgptMessage()
    }
  }

  const handleKeydown = (e: KeyboardEvent) => {
    if (e.isComposing || e.shiftKey)
      return

    if (e.key === 'Enter') {
      e.preventDefault()
      handleButtonClick()
    }
  }

  return (
    <div my-6>
      {/* beautiful coming soon alert box, position: fixed, screen center, no transparent background, z-index 100 */}
      <MessageInput
        messageChatgptList={messageChatgptList}
        currentChatgptAssistantMessage={currentChatgptAssistantMessage}
        messageGeminiList={messageGeminiList}
        retryLastFetch={retryLastGeminiFetch}
        retryLastChatgptFetch={retryLastChatgptFetch}
        currentGeminiAssistantMessage={currentGeminiAssistantMessage}
        currentGeminiError={currentGeminiError}
        currentChatgptError={currentChatgptError}
      />
      <Show
        when={!loading()}
        fallback={(
          <div class="gen-cb-wrapper">
            <span>AI is thinking...</span>
            <div class="gen-cb-stop" onClick={stopStreamFetch}>Stop</div>
          </div>
          )}
      >
        <div class="gen-text-wrapper relative">
          <textarea
            ref={inputRef!}
            onKeyDown={handleKeydown}
            placeholder="Enter something..."
            autocomplete="off"
            autofocus
            onInput={() => {
              inputRef.style.height = 'auto'
              inputRef.style.height = `${inputRef.scrollHeight}px`
            }}
            rows="1"
            class="gen-textarea"
          />
          <button onClick={handleButtonClick} gen-slate-btn>
            Send
          </button>
          <button title="Clear" onClick={clear} gen-slate-btn>
            <IconClear />
          </button>
        </div>
      </Show>
      {/* <div class="fixed bottom-5 left-5 rounded-md hover:bg-slate/10 w-fit h-fit transition-colors active:scale-90" class:stick-btn-on={isStick()}>
        <div>
          <button class="p-2.5 text-base" title="stick to bottom" type="button" onClick={() => setStick(!isStick())}>
            <div i-ph-arrow-line-down-bold />
          </button>
        </div>
      </div> */}
    </div>
  )
}
