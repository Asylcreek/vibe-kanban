import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Code,
  Code2,
  File,
  FileCode,
  FileText,
  Grid3X3,
  GraduationCap,
  Menu,
  Mic,
  PanelRightOpen,
  PenTool,
  Plus,
  Search,
  Settings,
  Sparkles,
  Target,
  User,
  X,
  Zap,
} from 'lucide-react';
import { BaseCodingAgent, type PatchType } from 'shared/types';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { attemptsApi, projectsApi, sessionsApi } from '@/lib/api';
import { streamJsonPatchEntries } from '@/utils/streamJsonPatchEntries';

interface Ui6Message {
  id: string;
  text: string;
  isUser: boolean;
  timestamp: Date;
}

interface Ui6Chat {
  id: string;
  title: string;
  messages: Ui6Message[];
  backendSessionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const DROID_EXECUTOR = BaseCodingAgent.DROID;
const DROID_VARIANT = 'GLM_4_7_0_CUSTOM';
const DROID_MODEL = 'custom:GLM-4.7-0';
const HARDCODED_TEST_WORKSPACE_ID = 'bc3fc146-8308-4812-b670-dc2a6ee9c978';

async function pickWorkspaceId(): Promise<string | null> {
  try {
    const preferred = await attemptsApi.get(HARDCODED_TEST_WORKSPACE_ID);
    return preferred.id;
  } catch {
    // Ignore; fallback to first available workspace below.
  }

  const workspaces = await attemptsApi.getAllWorkspaces();
  const firstWorkspace =
    workspaces.find((workspace) => !workspace.archived) ?? workspaces[0];
  return firstWorkspace?.id ?? null;
}

function extractAssistantText(entries: PatchType[]): string {
  return entries
    .filter(
      (entry): entry is Extract<PatchType, { type: 'NORMALIZED_ENTRY' }> =>
        entry.type === 'NORMALIZED_ENTRY' &&
        entry.content.entry_type.type === 'assistant_message'
    )
    .map((entry) => entry.content.content.trim())
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

interface Ui6ChatInputProps {
  onSendMessage: (message: string) => void;
  disabled?: boolean;
}

function Ui6ChatInput({ onSendMessage, disabled }: Ui6ChatInputProps) {
  const [message, setMessage] = useState('');
  const [model, setModel] = useState('GPT-5.2-Codex');
  const [intelligence, setIntelligence] = useState('High');

  const handleSubmit = () => {
    if (!message.trim() || disabled) return;
    onSendMessage(message.trim());
    setMessage('');
  };

  return (
    <div className="w-full">
      <div className="relative rounded-lg border border-[#333333] bg-[#1a1a1a] transition-colors focus-within:border-[#444444]">
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              handleSubmit();
            }
          }}
          placeholder="Ask for follow-up changes"
          className="min-h-[120px] w-full resize-none border-0 bg-transparent px-4 pb-14 pt-4 text-sm text-[#e5e5e5] placeholder:text-[#666666] outline-none"
          disabled={disabled}
        />

        <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between border-t border-[#2a2a2a] px-3 py-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="flex h-8 w-8 items-center justify-center rounded bg-transparent p-0 text-[#999999] transition-colors hover:bg-[#2a2a2a]"
              aria-label="Add attachments"
            >
              <Plus className="h-4 w-4" />
            </button>

            <label className="flex h-8 min-w-[120px] items-center gap-1 rounded px-2 text-sm text-[#e5e5e5] transition-colors hover:bg-[#2a2a2a]">
              <select
                value={model}
                onChange={(event) => setModel(event.target.value)}
                className="max-w-[110px] appearance-none border-0 bg-transparent outline-none"
              >
                <option>GPT-5.2-Codex</option>
                <option>GPT-4</option>
                <option>Claude-3</option>
              </select>
              <ChevronDown className="h-3 w-3 text-[#888888]" />
            </label>

            <label className="flex h-8 min-w-[72px] items-center gap-1 rounded px-2 text-sm text-[#e5e5e5] transition-colors hover:bg-[#2a2a2a]">
              <select
                value={intelligence}
                onChange={(event) => setIntelligence(event.target.value)}
                className="appearance-none border-0 bg-transparent outline-none"
              >
                <option>Low</option>
                <option>Medium</option>
                <option>High</option>
              </select>
              <ChevronDown className="h-3 w-3 text-[#888888]" />
            </label>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              className="flex h-8 w-8 items-center justify-center rounded bg-transparent p-0 text-[#999999] transition-colors hover:bg-[#2a2a2a]"
              aria-label="Voice input"
            >
              <Mic className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={handleSubmit}
              disabled={!message.trim() || disabled}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-[#666666] p-0 transition-colors hover:bg-[#777777] disabled:opacity-30 disabled:hover:bg-[#666666]"
              aria-label="Send message"
            >
              <ArrowUp className="h-4 w-4 text-black" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Ui6ChatMessage({ message }: { message: Ui6Message }) {
  return (
    <div
      className={`px-6 py-6 transition-colors ${
        message.isUser
          ? 'bg-[#0d0d0d]'
          : 'bg-[#111111] hover:bg-[#171717]'
      }`}
    >
      <div className="flex max-w-none gap-4">
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-orange-400 to-orange-600 text-white">
          {message.isUser ? <User className="h-4 w-4" /> : 'C'}
        </div>

        <div className="min-w-0 flex-1">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-sm font-medium text-[#e5e5e5]">
              {message.isUser ? 'You' : 'Claude'}
            </span>
            <span className="text-xs text-[#8c8c8c]">
              {message.timestamp.toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </div>
          <div className="whitespace-pre-wrap break-words text-[#d6d6d6] leading-relaxed">
            {message.text}
          </div>
        </div>
      </div>
    </div>
  );
}

function Ui6TypingIndicator() {
  return (
    <div className="bg-[#111111] px-6 py-6">
      <div className="flex max-w-none gap-4">
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-orange-400 to-orange-600 text-white">
          C
        </div>

        <div className="min-w-0 flex-1">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-sm font-medium text-[#e5e5e5]">Claude</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex space-x-1">
              <div className="h-2 w-2 animate-bounce rounded-full bg-[#777777] [animation-delay:-0.3s]" />
              <div className="h-2 w-2 animate-bounce rounded-full bg-[#777777] [animation-delay:-0.15s]" />
              <div className="h-2 w-2 animate-bounce rounded-full bg-[#777777]" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Ui6Welcome({ onSendMessage }: { onSendMessage: (message: string) => void }) {
  const actions = [
    {
      icon: Code,
      label: 'Code',
      className: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    },
    {
      icon: PenTool,
      label: 'Write',
      className: 'bg-green-500/10 text-green-400 border-green-500/20',
    },
    {
      icon: Target,
      label: 'Strategize',
      className: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
    },
    {
      icon: GraduationCap,
      label: 'Learn',
      className: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
    },
    {
      icon: Grid3X3,
      label: 'From your apps',
      className: 'bg-pink-500/10 text-pink-400 border-pink-500/20',
    },
  ];

  return (
    <div className="flex h-full flex-col bg-[#0d0d0d]">
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col items-center justify-center px-8">
        <div className="mb-12 text-center">
          <div className="mb-2 flex items-center justify-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-orange-400 to-orange-600">
              <Sparkles className="h-5 w-5 text-white" />
            </div>
          </div>
          <h1 className="mb-1 text-2xl text-[#e5e5e5]">What&apos;s new, Esmondrio?</h1>
          <p className="text-sm text-[#999999]">
            Start a conversation or try one of the suggestions below
          </p>
        </div>

        <div className="flex flex-wrap justify-center gap-2">
          <button
            type="button"
            className="inline-flex h-8 items-center rounded-md border border-gray-500/20 bg-gray-500/10 px-3 text-sm text-gray-400 transition-colors hover:bg-gray-500/20"
          >
            <Search className="mr-2 h-4 w-4" />
            Research
          </button>

          <button
            type="button"
            className="inline-flex h-8 items-center rounded-md border border-blue-500/20 bg-blue-500/10 px-3 text-sm text-blue-400 transition-colors hover:bg-blue-500/20"
          >
            Claude Sonnet 4
            <span className="ml-2 rounded bg-orange-500 px-1.5 py-0.5 text-xs text-white">
              1
            </span>
          </button>

          {actions.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.label}
                type="button"
                className={`inline-flex h-8 items-center rounded-md border px-3 text-sm transition-opacity hover:opacity-80 ${action.className}`}
                onClick={() =>
                  onSendMessage(`Help me with ${action.label.toLowerCase()}`)
                }
              >
                <Icon className="mr-2 h-4 w-4" />
                {action.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-shrink-0 border-t border-[#1a1a1a] bg-[#0d0d0d] px-6 py-4">
        <div className="mx-auto max-w-4xl">
          <Ui6ChatInput onSendMessage={onSendMessage} />
        </div>
      </div>
    </div>
  );
}

function Ui6RightSidebar({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const [activeTab, setActiveTab] = useState<'artifacts' | 'files'>('artifacts');

  if (!isOpen) return null;

  const artifacts = [
    { id: 'a-1', name: 'React Component', type: 'code', icon: Code2 },
    { id: 'a-2', name: 'API Documentation', type: 'document', icon: FileText },
    { id: 'a-3', name: 'Database Schema', type: 'code', icon: FileCode },
  ];

  const files = [
    { id: 'f-1', name: 'integrations', icon: File },
    { id: 'f-2', name: 'logs', icon: File },
    { id: 'f-3', name: 'settings.json', icon: FileCode },
    { id: 'f-4', name: 'workspaces', icon: File },
    { id: 'f-5', name: 'chat-interface.tsx', icon: FileCode },
    { id: 'f-6', name: 'creating-workspaces.mdx', icon: FileText },
    { id: 'f-7', name: 'git-operations.mdx', icon: FileText },
    { id: 'f-8', name: 'index.mdx', icon: FileText },
    { id: 'f-9', name: 'interface.mdx', icon: FileText },
  ];

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-40 bg-black/50 md:hidden"
        onClick={onClose}
        aria-label="Close details"
      />

      <aside className="fixed right-0 top-0 z-50 flex h-screen w-80 flex-col border-l border-[#333333] bg-[#0d0d0d] md:relative md:z-auto">
        <div className="flex items-center justify-between border-b border-[#333333] px-4 py-3">
          <h2 className="font-medium text-[#e5e5e5]">Details</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded text-[#999999] transition-colors hover:bg-[#2a2a2a] hover:text-[#e5e5e5]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex h-12 items-center justify-start gap-2 border-b border-[#333333] px-4">
          <button
            type="button"
            onClick={() => setActiveTab('artifacts')}
            className={`rounded-none border-b-2 pb-1 text-sm ${
              activeTab === 'artifacts'
                ? 'border-[#e5e5e5] text-[#e5e5e5]'
                : 'border-transparent text-[#999999]'
            }`}
          >
            Artifacts
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('files')}
            className={`rounded-none border-b-2 pb-1 text-sm ${
              activeTab === 'files'
                ? 'border-[#e5e5e5] text-[#e5e5e5]'
                : 'border-transparent text-[#999999]'
            }`}
          >
            Files
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {activeTab === 'artifacts' ? (
            <div className="space-y-2">
              {artifacts.map((artifact) => {
                const Icon = artifact.icon;
                return (
                  <button
                    type="button"
                    key={artifact.id}
                    className="flex w-full items-center gap-3 rounded-lg p-3 text-left transition-colors hover:bg-[#1a1a1a]"
                  >
                    <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded bg-[#1a1a1a]">
                      <Icon className="h-4 w-4 text-[#e5e5e5]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-[#e5e5e5]">
                        {artifact.name}
                      </p>
                      <p className="text-xs capitalize text-[#999999]">
                        {artifact.type}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="space-y-1">
              {files.map((file) => {
                const Icon = file.icon;
                return (
                  <button
                    type="button"
                    key={file.id}
                    className="flex w-full items-center gap-2 rounded p-2 text-left transition-colors hover:bg-[#1a1a1a]"
                  >
                    <Icon className="h-4 w-4 flex-shrink-0 text-[#999999]" />
                    <span className="truncate text-sm text-[#e5e5e5]">{file.name}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

interface ThreadNode {
  title: string;
  isExpanded?: boolean;
  children?: Array<{ title: string; time: string }>;
}

function Ui6ThreadItem({
  title,
  isExpanded = false,
  onSelect,
}: {
  title: string;
  isExpanded?: boolean;
  onSelect: () => void;
}) {
  const [expanded, setExpanded] = useState(isExpanded);

  return (
    <button
      type="button"
      onClick={() => {
        setExpanded((prev) => !prev);
        onSelect();
      }}
      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-[#e5e5e5] transition-colors hover:bg-[#2a2a2a]"
    >
      {expanded ? (
        <ChevronDown className="h-3 w-3 flex-shrink-0" />
      ) : (
        <ChevronRight className="h-3 w-3 flex-shrink-0" />
      )}
      <span className="truncate">{title}</span>
    </button>
  );
}

export function Ui6ChatbotPage() {
  const isMobile = useMediaQuery('(max-width: 767px)');
  const [isThreadsExpanded, setIsThreadsExpanded] = useState(true);
  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(true);
  const [isRightSidebarOpen, setIsRightSidebarOpen] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [chats, setChats] = useState<Ui6Chat[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [workspaceStatus, setWorkspaceStatus] = useState(
    'Loading workspace...'
  );
  const [isCreateProjectModalOpen, setIsCreateProjectModalOpen] =
    useState(false);
  const [createProjectName, setCreateProjectName] = useState('');
  const [createProjectRepoPath, setCreateProjectRepoPath] = useState('');
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [repoPickerMessage, setRepoPickerMessage] = useState<string | null>(
    null
  );
  const [createProjectMessage, setCreateProjectMessage] = useState<
    string | null
  >(null);

  const messageScrollRef = useRef<HTMLDivElement | null>(null);
  const activeStreamRef = useRef<ReturnType<
    typeof streamJsonPatchEntries<PatchType>
  > | null>(null);

  const currentChat = useMemo(
    () => chats.find((chat) => chat.id === currentChatId) ?? null,
    [chats, currentChatId]
  );

  useEffect(() => {
    let cancelled = false;

    const loadWorkspace = async () => {
      try {
        const preferredWorkspaceId = await pickWorkspaceId();

        if (cancelled) return;

        if (!preferredWorkspaceId) {
          setWorkspaceStatus('No workspace found. Create one at /workspaces/create.');
          return;
        }

        setWorkspaceId(preferredWorkspaceId);
        setWorkspaceStatus(`Workspace ${preferredWorkspaceId.slice(0, 8)}`);
      } catch {
        if (cancelled) return;
        setWorkspaceStatus('Failed to load workspaces.');
      }
    };

    void loadWorkspace();

    return () => {
      cancelled = true;
      activeStreamRef.current?.close();
      activeStreamRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!isMobile) {
      setIsLeftSidebarOpen(true);
    }
  }, [isMobile]);

  useEffect(() => {
    if (!messageScrollRef.current) return;
    messageScrollRef.current.scrollTop = messageScrollRef.current.scrollHeight;
  }, [currentChat?.messages, isTyping]);

  const createChat = (title = 'New Chat', initialMessages: Ui6Message[] = []) => {
    const now = new Date();
    const newChat: Ui6Chat = {
      id: `${Date.now()}`,
      title,
      messages: initialMessages,
      backendSessionId: null,
      createdAt: now,
      updatedAt: now,
    };

    setChats((prev) => [newChat, ...prev]);
    setCurrentChatId(newChat.id);
    return newChat;
  };

  const setAssistantMessage = (
    chatId: string,
    messageId: string,
    text: string
  ) => {
    setChats((prev) =>
      prev.map((chat) => {
        if (chat.id !== chatId) return chat;

        const existingMessage = chat.messages.find(
          (message) => message.id === messageId
        );
        const updatedMessages = existingMessage
          ? chat.messages.map((message) =>
              message.id === messageId ? { ...message, text } : message
            )
          : [
              ...chat.messages,
              {
                id: messageId,
                text,
                isUser: false,
                timestamp: new Date(),
              },
            ];

        return {
          ...chat,
          updatedAt: new Date(),
          messages: updatedMessages,
        };
      })
    );
  };

  const resolveWorkspaceId = async (): Promise<string | null> => {
    if (workspaceId) return workspaceId;

    try {
      const preferredWorkspaceId = await pickWorkspaceId();

      if (!preferredWorkspaceId) {
        setWorkspaceStatus('No workspace found. Create one at /workspaces/create.');
        return null;
      }

      setWorkspaceId(preferredWorkspaceId);
      setWorkspaceStatus(`Workspace ${preferredWorkspaceId.slice(0, 8)}`);
      return preferredWorkspaceId;
    } catch {
      setWorkspaceStatus('Failed to load workspaces.');
      return null;
    }
  };

  const sendToBackend = async (
    chatId: string,
    prompt: string,
    initialSessionId: string | null
  ) => {
    const assistantMessageId = `${Date.now()}-assistant`;
    setAssistantMessage(chatId, assistantMessageId, 'Running...');

    const workspaceIdToUse = await resolveWorkspaceId();
    if (!workspaceIdToUse) {
      setAssistantMessage(
        chatId,
        assistantMessageId,
        'No workspace available. Create one at /workspaces/create first.'
      );
      return;
    }

    setIsTyping(true);
    activeStreamRef.current?.close();

    try {
      let sessionId = initialSessionId;

      if (!sessionId) {
        const session = await sessionsApi.create({
          workspace_id: workspaceIdToUse,
          executor: DROID_EXECUTOR,
        });
        sessionId = session.id;
        setChats((prev) =>
          prev.map((chat) =>
            chat.id === chatId ? { ...chat, backendSessionId: sessionId } : chat
          )
        );
      }

      const process = await sessionsApi.followUp(sessionId, {
        prompt,
        executor_profile_id: {
          executor: DROID_EXECUTOR,
          variant: DROID_VARIANT,
        },
        retry_process_id: null,
        force_when_dirty: null,
        perform_git_reset: null,
      });

      activeStreamRef.current = streamJsonPatchEntries<PatchType>(
        `/api/execution-processes/${process.id}/normalized-logs/ws`,
        {
          onEntries: (entries) => {
            const assistantText = extractAssistantText(entries);
            if (assistantText) {
              setAssistantMessage(chatId, assistantMessageId, assistantText);
            }
          },
          onFinished: (entries) => {
            const assistantText = extractAssistantText(entries);
            if (!assistantText) {
              setAssistantMessage(
                chatId,
                assistantMessageId,
                `Completed. Open /workspaces/${workspaceIdToUse} for full logs.`
              );
            }
            setIsTyping(false);
            activeStreamRef.current = null;
          },
          onError: () => {
            setAssistantMessage(
              chatId,
              assistantMessageId,
              `Stream failed. Open /workspaces/${workspaceIdToUse} for live output.`
            );
            setIsTyping(false);
            activeStreamRef.current = null;
          },
        }
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown backend error';
      setAssistantMessage(chatId, assistantMessageId, `Error: ${message}`);
      setIsTyping(false);
    }
  };

  const handleSendMessage = (message: string) => {
    const trimmed = message.trim();
    if (!trimmed) return;

    if (!currentChat) {
      const userMessage: Ui6Message = {
        id: `${Date.now()}-user`,
        text: trimmed,
        isUser: true,
        timestamp: new Date(),
      };
      const newChat = createChat(
        trimmed.slice(0, 50) + (trimmed.length > 50 ? '...' : ''),
        [userMessage]
      );
      void sendToBackend(newChat.id, trimmed, newChat.backendSessionId);
      return;
    }

    const userMessage: Ui6Message = {
      id: `${Date.now()}-user`,
      text: trimmed,
      isUser: true,
      timestamp: new Date(),
    };

    setChats((prev) =>
      prev.map((chat) => {
        if (chat.id !== currentChat.id) return chat;
        return {
          ...chat,
          title:
            chat.messages.length === 0
              ? trimmed.slice(0, 50) + (trimmed.length > 50 ? '...' : '')
              : chat.title,
          updatedAt: new Date(),
          messages: [...chat.messages, userMessage],
        };
      })
    );

    void sendToBackend(currentChat.id, trimmed, currentChat.backendSessionId);
  };

  const openCreateProjectModal = () => {
    setCreateProjectMessage(null);
    setRepoPickerMessage(null);
    setIsCreateProjectModalOpen(true);
  };

  const closeCreateProjectModal = () => {
    setIsCreateProjectModalOpen(false);
  };

  const selectRepoFolder = async () => {
    const windowWithDirectoryPicker = window as Window & {
      showDirectoryPicker?: () => Promise<{ name: string; path?: string }>;
    };

    if (!windowWithDirectoryPicker.showDirectoryPicker) {
      setRepoPickerMessage(
        'Folder picker is not supported in this browser. Paste the folder path manually.'
      );
      return;
    }

    try {
      const handle = await windowWithDirectoryPicker.showDirectoryPicker();
      setCreateProjectRepoPath(handle.path ?? handle.name);
      setRepoPickerMessage(null);
    } catch {
      // User cancelled folder picker.
    }
  };

  const handleCreateProject = async () => {
    const projectName = createProjectName.trim();
    const repoPath = createProjectRepoPath.trim();

    if (!projectName) {
      setCreateProjectMessage('Project name is required.');
      return;
    }

    if (!repoPath) {
      setCreateProjectMessage('Repo path is required.');
      return;
    }

    const repoNameFromPath =
      repoPath.split(/[\\/]/).filter(Boolean).pop() ?? projectName;

    setIsCreatingProject(true);
    setCreateProjectMessage(null);

    try {
      const project = await projectsApi.create({
        name: projectName,
        repositories: [
          {
            display_name: repoNameFromPath,
            git_repo_path: repoPath,
          },
        ],
      });

      console.info('[new-ui] Project created', project);

      setCreateProjectName('');
      setCreateProjectRepoPath('');
      setCreateProjectMessage(null);
      setRepoPickerMessage(null);
      setIsCreateProjectModalOpen(false);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to create project.';
      setCreateProjectMessage(message);
    } finally {
      setIsCreatingProject(false);
    }
  };

  const threads: ThreadNode[] = [
    {
      title: '10p-customer',
      isExpanded: true,
      children: [
        { title: 'Implement this design from Figm...', time: '22h' },
        { title: 'Implement Figma withdraw modal', time: '22h' },
        { title: 'Implement this design from Figm...', time: '1d' },
        { title: 'Implement Figma deposit modal', time: '1d' },
        { title: 'Implement Figma wallet page', time: '1d' },
      ],
    },
    {
      title: 'code-agent',
      children: [
        { title: 'Install frontend-design skill', time: '1d' },
        { title: 'Add agent-browser skill', time: '1d' },
        { title: 'Review project documentation', time: '1d' },
      ],
    },
    {
      title: 'code-agent - New project 2',
      children: [
        { title: 'how would one go about building...', time: '1d' },
        { title: 'what the', time: '' },
        { title: 'how would one build an app like t...', time: '' },
      ],
    },
  ];

  return (
    <div className="new-design h-screen w-full">
      <div className="relative flex h-screen w-full overflow-hidden bg-[#0d0d0d]">
        {isMobile && (isLeftSidebarOpen || isRightSidebarOpen) && (
          <button
            type="button"
            className="fixed inset-0 z-30 bg-black/50"
            onClick={() => {
              setIsLeftSidebarOpen(false);
              setIsRightSidebarOpen(false);
            }}
            aria-label="Close sidebars"
          />
        )}

        <aside
          className={`
            z-40 h-screen flex-shrink-0 border-r border-[#2a2a2a] bg-[#171717]
            transition-transform duration-200 md:relative md:translate-x-0
            ${isMobile ? 'fixed left-0 top-0 w-64' : 'w-64'}
            ${isLeftSidebarOpen ? 'translate-x-0' : '-translate-x-full md:hidden'}
          `}
        >
          <div className="space-y-2 p-3">
            <button
              type="button"
              onClick={() => {
                createChat();
                if (isMobile) setIsLeftSidebarOpen(false);
              }}
              className="flex h-9 w-full items-center justify-start rounded bg-transparent px-3 text-sm font-normal text-[#e5e5e5] transition-colors hover:bg-[#2a2a2a]"
            >
              <Plus className="mr-2 h-4 w-4" />
              New thread
            </button>

            <button
              type="button"
              className="flex h-9 w-full items-center justify-start rounded px-3 text-sm font-normal text-[#a1a1a1] transition-colors hover:bg-[#2a2a2a] hover:text-[#e5e5e5]"
            >
              <Zap className="mr-2 h-4 w-4" />
              Automations
            </button>

            <button
              type="button"
              className="flex h-9 w-full items-center justify-start rounded px-3 text-sm font-normal text-[#a1a1a1] transition-colors hover:bg-[#2a2a2a] hover:text-[#e5e5e5]"
            >
              <Grid3X3 className="mr-2 h-4 w-4" />
              Skills
            </button>
          </div>

          <div className="h-[calc(100%-132px)] overflow-y-auto px-3 py-2">
            <div className="flex items-center gap-1 px-1 py-1">
              <button
                type="button"
                onClick={() => setIsThreadsExpanded((prev) => !prev)}
                className="flex min-w-0 flex-1 items-center gap-2 rounded px-1.5 py-1 text-xs font-medium text-[#999999] transition-colors hover:bg-[#2a2a2a] hover:text-[#e5e5e5]"
              >
                {isThreadsExpanded ? (
                  <ChevronDown className="h-3 w-3 flex-shrink-0" />
                ) : (
                  <ChevronRight className="h-3 w-3 flex-shrink-0" />
                )}
                <span className="truncate">Threads</span>
              </button>

              <button
                type="button"
                onClick={openCreateProjectModal}
                className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-[#999999] transition-colors hover:bg-[#2a2a2a] hover:text-[#e5e5e5]"
                aria-label="Open create project form"
                title="Create project"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>

            {isThreadsExpanded && (
              <div className="mt-1 space-y-0.5">
                {threads.map((thread) => (
                  <div key={thread.title}>
                    <Ui6ThreadItem
                      title={thread.title}
                      isExpanded={thread.isExpanded}
                      onSelect={() => {
                        if (isMobile) setIsLeftSidebarOpen(false);
                      }}
                    />

                    {thread.isExpanded && thread.children && (
                      <div className="ml-4 mt-0.5 space-y-0.5">
                        {thread.children.map((child) => (
                          <button
                            type="button"
                            key={`${thread.title}-${child.title}`}
                            onClick={() => {
                              handleSendMessage(child.title);
                              if (isMobile) setIsLeftSidebarOpen(false);
                            }}
                            className="group flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm text-[#a1a1a1] transition-colors hover:bg-[#2a2a2a] hover:text-[#e5e5e5]"
                          >
                            <span className="mr-2 flex-1 truncate">{child.title}</span>
                            {child.time && (
                              <span className="flex-shrink-0 text-xs text-[#666666] group-hover:text-[#999999]">
                                {child.time}
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}

              </div>
            )}
          </div>

          <div className="border-t border-[#2a2a2a] p-3">
            <button
              type="button"
              className="flex h-9 w-full items-center justify-start rounded px-3 text-sm font-normal text-[#a1a1a1] transition-colors hover:bg-[#2a2a2a] hover:text-[#e5e5e5]"
            >
              <Settings className="mr-2 h-4 w-4" />
              Settings
            </button>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="z-10 flex flex-shrink-0 items-center gap-2 border-b border-[#1a1a1a] bg-[#0d0d0d] px-4 py-3">
            <button
              type="button"
              onClick={() => setIsLeftSidebarOpen((prev) => !prev)}
              className="flex h-8 w-8 items-center justify-center rounded p-0 text-[#999999] transition-colors hover:bg-[#2a2a2a]"
            >
              <Menu className="h-4 w-4" />
            </button>

            <div className="min-w-0 flex-1">
              {currentChat && (
                <h1 className="truncate text-sm font-medium text-[#e5e5e5]">
                  {currentChat.title}
                </h1>
              )}
              <p className="truncate text-xs text-[#777777]">
                {workspaceId
                  ? `DROID · ${DROID_MODEL} · ${workspaceId.slice(0, 8)}`
                  : workspaceStatus}
              </p>
            </div>

            <button
              type="button"
              onClick={() => setIsRightSidebarOpen((prev) => !prev)}
              className={`ml-auto flex h-8 w-8 items-center justify-center rounded text-[#999999] transition-colors hover:bg-[#2a2a2a] ${
                isRightSidebarOpen ? 'bg-[#2a2a2a]' : ''
              }`}
            >
              <PanelRightOpen className="h-4 w-4" />
            </button>
          </div>

          {currentChat && currentChat.messages.length > 0 ? (
            <div className="flex h-full flex-col bg-[#0d0d0d]">
              <div ref={messageScrollRef} className="flex-1 overflow-y-auto">
                <div className="mx-auto max-w-4xl px-6 py-8">
                  {currentChat.messages.map((message) => (
                    <Ui6ChatMessage key={message.id} message={message} />
                  ))}
                  {isTyping && <Ui6TypingIndicator />}
                </div>
              </div>

              <div className="flex-shrink-0 border-t border-[#1a1a1a] bg-[#0d0d0d] px-6 py-4">
                <div className="mx-auto max-w-4xl">
                  <Ui6ChatInput
                    onSendMessage={handleSendMessage}
                    disabled={isTyping}
                  />
                </div>
              </div>
            </div>
          ) : (
            <Ui6Welcome onSendMessage={handleSendMessage} />
          )}
        </div>

        <Ui6RightSidebar
          isOpen={isRightSidebarOpen}
          onClose={() => setIsRightSidebarOpen(false)}
        />

        {isCreateProjectModalOpen && (
          <>
            <button
              type="button"
              className="fixed inset-0 z-50 bg-black/70"
              onClick={closeCreateProjectModal}
              aria-label="Close create project form"
            />

            <div
              role="dialog"
              aria-modal="true"
              aria-label="Create Project"
              className="fixed left-1/2 top-1/2 z-[60] w-[min(760px,94vw)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-[#2e2e2e] bg-[#121212] shadow-[0_28px_80px_rgba(0,0,0,0.7)]"
            >
              <div className="flex items-center justify-between border-b border-[#242424] px-5 py-4">
                <div>
                  <h2 className="text-base font-medium text-[#ececec]">
                    Create Project
                  </h2>
                </div>

                <button
                  type="button"
                  onClick={closeCreateProjectModal}
                  className="flex h-8 w-8 items-center justify-center rounded text-[#999999] transition-colors hover:bg-[#2a2a2a] hover:text-[#e5e5e5]"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="max-h-[70vh] space-y-4 overflow-y-auto px-5 py-4">
                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-[#d9d9d9]">
                    Name
                  </label>
                  <input
                    type="text"
                    value={createProjectName}
                    onChange={(event) => setCreateProjectName(event.target.value)}
                    placeholder="My project"
                    className="h-10 w-full rounded-md border border-[#303030] bg-[#1a1a1a] px-3 text-sm text-[#e5e5e5] outline-none transition-colors placeholder:text-[#666666] focus:border-[#4a4a4a]"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-[#d9d9d9]">
                    Repo path
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={createProjectRepoPath}
                      onChange={(event) =>
                        setCreateProjectRepoPath(event.target.value)
                      }
                      placeholder="/Users/you/projects/vibe-kanban"
                      className="h-10 flex-1 rounded-md border border-[#303030] bg-[#1a1a1a] px-3 text-sm text-[#e5e5e5] outline-none transition-colors placeholder:text-[#666666] focus:border-[#4a4a4a]"
                    />
                    <button
                      type="button"
                      onClick={() => void selectRepoFolder()}
                      className="inline-flex h-10 items-center rounded-md border border-[#343434] px-3 text-sm text-[#cfcfcf] transition-colors hover:bg-[#232323]"
                    >
                      Select folder
                    </button>
                  </div>
                  {repoPickerMessage && (
                    <p className="text-xs text-[#9a9a9a]">{repoPickerMessage}</p>
                  )}
                </div>

                {createProjectMessage && (
                  <p className="text-sm text-[#ff8f8f]">{createProjectMessage}</p>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-[#242424] px-5 py-4">
                <button
                  type="button"
                  onClick={closeCreateProjectModal}
                  className="inline-flex h-9 items-center rounded-md border border-[#343434] px-3 text-sm text-[#c9c9c9] transition-colors hover:bg-[#232323]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleCreateProject()}
                  disabled={isCreatingProject}
                  className="inline-flex h-9 items-center rounded-md bg-[#ececec] px-3 text-sm font-medium text-[#121212] transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isCreatingProject ? 'Creating...' : 'Create project'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
