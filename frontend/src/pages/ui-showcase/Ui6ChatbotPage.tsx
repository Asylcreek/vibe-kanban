import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Code,
  Code2,
  File,
  FileCode,
  FileText,
  GitBranch as GitBranchIcon,
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
import {
  BaseCodingAgent,
  type ChatThreadMessage,
  type ChatThreadExecutionMode,
  type ExecutionProcess,
  type PatchType,
  type Project,
} from 'shared/types';
import { useUserSystem } from '@/components/ConfigProvider';
import WYSIWYGEditor from '@/components/ui/wysiwyg';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { executionProcessesApi, newUiApi, projectsApi, repoApi } from '@/lib/api';
import { getVariantOptions } from '@/utils/executor';
import { streamJsonPatchEntries } from '@/utils/streamJsonPatchEntries';

interface Ui6Message {
  id: string;
  text: string;
  isUser: boolean;
  timestamp: Date;
}

interface Ui6Chat {
  id: string; // backend thread id
  projectId: string;
  title: string;
  executionMode: ChatThreadExecutionMode;
  messages: Ui6Message[];
  selectedExecutor: BaseCodingAgent | null;
  selectedVariant: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const DROID_EXECUTOR = BaseCodingAgent.DROID;
const NEW_UI_THREAD_PREFS_KEY = 'new_ui_thread_executor_prefs_v1';
const NEW_UI_DRAFT_PREFS_KEY = 'new_ui_draft_executor_prefs_v1';

interface ExecutorPrefs {
  executor: BaseCodingAgent | null;
  variant: string | null;
}

function toUiMessage(message: ChatThreadMessage): Ui6Message {
  return {
    id: message.id,
    text: message.content,
    isUser: message.role === 'user',
    timestamp: new Date(message.created_at),
  };
}

function extractAssistantText(entries: PatchType[]): string {
  const assistantEntries = entries
    .filter(
      (entry): entry is Extract<PatchType, { type: 'NORMALIZED_ENTRY' }> =>
        entry.type === 'NORMALIZED_ENTRY' &&
        entry.content.entry_type.type === 'assistant_message'
    )
    .map((entry) => entry.content.content.trim())
    .filter(Boolean);

  return assistantEntries[assistantEntries.length - 1] ?? '';
}

function readThreadPrefs(): Record<string, ExecutorPrefs> {
  if (typeof window === 'undefined') return {};
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(NEW_UI_THREAD_PREFS_KEY) ?? '{}'
    ) as Record<string, ExecutorPrefs>;
    return parsed ?? {};
  } catch {
    return {};
  }
}

function writeThreadPrefs(threadId: string, prefs: ExecutorPrefs) {
  if (typeof window === 'undefined') return;
  const current = readThreadPrefs();
  current[threadId] = prefs;
  window.localStorage.setItem(NEW_UI_THREAD_PREFS_KEY, JSON.stringify(current));
}

function readDraftPrefs(): ExecutorPrefs {
  if (typeof window === 'undefined') {
    return { executor: null, variant: null };
  }
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(NEW_UI_DRAFT_PREFS_KEY) ?? '{}'
    ) as ExecutorPrefs;
    return {
      executor: parsed?.executor ?? null,
      variant: parsed?.variant ?? null,
    };
  } catch {
    return { executor: null, variant: null };
  }
}

function writeDraftPrefs(prefs: ExecutorPrefs) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(NEW_UI_DRAFT_PREFS_KEY, JSON.stringify(prefs));
}

function assistantInitial(label: string): string {
  const trimmed = label.trim();
  return trimmed.length > 0 ? trimmed[0]!.toUpperCase() : 'A';
}

function executorDisplayName(executor: BaseCodingAgent | null): string {
  if (!executor) return 'Assistant';
  switch (executor) {
    case BaseCodingAgent.CLAUDE_CODE:
      return 'Claude';
    case BaseCodingAgent.CODEX:
      return 'Codex';
    case BaseCodingAgent.GEMINI:
      return 'Gemini';
    case BaseCodingAgent.DROID:
      return 'DROID';
    case BaseCodingAgent.CURSOR_AGENT:
      return 'Cursor';
    case BaseCodingAgent.COPILOT:
      return 'Copilot';
    case BaseCodingAgent.AMP:
      return 'Amp';
    case BaseCodingAgent.OPENCODE:
      return 'Opencode';
    case BaseCodingAgent.QWEN_CODE:
      return 'Qwen';
    default:
      return String(executor);
  }
}

interface Ui6ChatInputProps {
  onSendMessage: (message: string) => void;
  selectedExecutor: BaseCodingAgent | null;
  selectedVariant: string | null;
  executorOptions: BaseCodingAgent[];
  variantOptions: string[];
  onExecutorChange: (executor: BaseCodingAgent) => void;
  onVariantChange: (variant: string | null) => void;
  disabled?: boolean;
}

function Ui6ChatInput({
  onSendMessage,
  selectedExecutor,
  selectedVariant,
  executorOptions,
  variantOptions,
  onExecutorChange,
  onVariantChange,
  disabled,
}: Ui6ChatInputProps) {
  const [message, setMessage] = useState('');

  const handleSubmit = () => {
    if (!message.trim() || disabled) return;
    onSendMessage(message.trim());
    setMessage('');
  };

  return (
    <div className="w-full">
      <div className="flex flex-col rounded-lg border border-[#333333] bg-[#1a1a1a] transition-colors focus-within:border-[#444444]">
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
          className="min-h-[110px] max-h-[220px] w-full resize-none overflow-y-auto border-0 bg-transparent px-4 pt-4 text-sm text-[#e5e5e5] placeholder:text-[#666666] outline-none"
          disabled={disabled}
        />

        <div className="flex flex-shrink-0 items-center justify-between border-t border-[#2a2a2a] px-3 py-2">
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
                value={selectedExecutor ?? ''}
                onChange={(event) =>
                  onExecutorChange(event.target.value as BaseCodingAgent)
                }
                className="max-w-[110px] appearance-none border-0 bg-transparent outline-none"
                disabled={disabled || executorOptions.length === 0}
              >
                {executorOptions.map((executor) => (
                  <option key={executor} value={executor}>
                    {executor}
                  </option>
                ))}
              </select>
              <ChevronDown className="h-3 w-3 text-[#888888]" />
            </label>

            <label className="flex h-8 min-w-[72px] items-center gap-1 rounded px-2 text-sm text-[#e5e5e5] transition-colors hover:bg-[#2a2a2a]">
              <select
                value={selectedVariant ?? ''}
                onChange={(event) =>
                  onVariantChange(event.target.value || null)
                }
                className="appearance-none border-0 bg-transparent outline-none"
                disabled={disabled || variantOptions.length === 0}
              >
                {variantOptions.map((variant) => (
                  <option key={variant} value={variant}>
                    {variant}
                  </option>
                ))}
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

function Ui6ChatMessage({
  message,
  assistantLabel,
}: {
  message: Ui6Message;
  assistantLabel: string;
}) {
  const assistantBadge = assistantInitial(assistantLabel);
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
          {message.isUser ? <User className="h-4 w-4" /> : assistantBadge}
        </div>

        <div className="min-w-0 flex-1">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-sm font-medium text-[#e5e5e5]">
              {message.isUser ? 'You' : assistantLabel}
            </span>
            <span className="text-xs text-[#8c8c8c]">
              {message.timestamp.toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </div>
          <div className="whitespace-pre-wrap break-words text-[#d6d6d6] leading-relaxed">
            {message.isUser ? (
              message.text
            ) : (
              <WYSIWYGEditor
                value={message.text}
                disabled
                className="min-h-0 bg-transparent p-0 text-[#d6d6d6] [&_p]:mb-2 [&_p:last-child]:mb-0"
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Ui6TypingIndicator({ assistantLabel }: { assistantLabel: string }) {
  const assistantBadge = assistantInitial(assistantLabel);
  return (
    <div className="bg-[#111111] px-6 py-6">
      <div className="flex max-w-none gap-4">
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-orange-400 to-orange-600 text-white">
          {assistantBadge}
        </div>

        <div className="min-w-0 flex-1">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-sm font-medium text-[#e5e5e5]">
              {assistantLabel}
            </span>
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

function Ui6Welcome({
  onSendMessage,
  selectedExecutor,
  selectedVariant,
  executorOptions,
  variantOptions,
  onExecutorChange,
  onVariantChange,
  currentMode,
  onModeChange,
  isUpdatingMode,
  modeError,
  currentBranch,
  disabled,
}: {
  onSendMessage: (message: string) => void;
  selectedExecutor: BaseCodingAgent | null;
  selectedVariant: string | null;
  executorOptions: BaseCodingAgent[];
  variantOptions: string[];
  onExecutorChange: (executor: BaseCodingAgent) => void;
  onVariantChange: (variant: string | null) => void;
  currentMode: ChatThreadExecutionMode | null;
  onModeChange: (mode: ChatThreadExecutionMode) => void;
  isUpdatingMode: boolean;
  modeError: string | null;
  currentBranch: string | null;
  disabled?: boolean;
}) {
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
          <Ui6ChatInput
            onSendMessage={onSendMessage}
            selectedExecutor={selectedExecutor}
            selectedVariant={selectedVariant}
            executorOptions={executorOptions}
            variantOptions={variantOptions}
            onExecutorChange={onExecutorChange}
            onVariantChange={onVariantChange}
            disabled={disabled}
          />
          <Ui6ExecutionBar
            currentMode={currentMode}
            onModeChange={onModeChange}
            isUpdatingMode={isUpdatingMode}
            modeError={modeError}
            currentBranch={currentBranch}
            disabled={disabled}
          />
        </div>
      </div>
    </div>
  );
}

function Ui6ExecutionBar({
  currentMode,
  onModeChange,
  isUpdatingMode,
  modeError,
  currentBranch,
  disabled,
}: {
  currentMode: ChatThreadExecutionMode | null;
  onModeChange: (mode: ChatThreadExecutionMode) => void;
  isUpdatingMode: boolean;
  modeError: string | null;
  currentBranch: string | null;
  disabled?: boolean;
}) {
  if (!currentMode) return null;

  return (
    <>
      <div className="mt-3 flex items-center justify-between px-1 py-1 text-xs text-[#a1a1a1]">
        <label className="flex items-center gap-1 rounded px-1.5 py-1 text-sm text-[#e5e5e5] transition-colors hover:bg-[#2a2a2a]">
          <select
            value={currentMode}
            onChange={(event) =>
              onModeChange(event.target.value as ChatThreadExecutionMode)
            }
            className="appearance-none border-0 bg-transparent outline-none"
            disabled={disabled || isUpdatingMode}
          >
            <option value="in_place">Local</option>
            <option value="isolated">Worktree</option>
          </select>
          <ChevronDown className="h-3 w-3 text-[#888888]" />
        </label>

        <div className="flex items-center gap-2 text-sm text-[#d0d0d0]">
          <GitBranchIcon className="h-3.5 w-3.5 text-[#8b8b8b]" />
          <span>{currentBranch ?? 'unknown'}</span>
        </div>
      </div>
      {modeError ? <p className="mt-1 text-xs text-[#ff8f8f]">{modeError}</p> : null}
    </>
  );
}

function Ui6RightSidebar({
  isOpen,
  onClose,
  width,
  isMobile,
  onResizeStart,
}: {
  isOpen: boolean;
  onClose: () => void;
  width: number;
  isMobile: boolean;
  onResizeStart: (event: React.PointerEvent<HTMLDivElement>) => void;
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

      <aside
        className={`fixed right-0 top-0 z-50 flex h-screen flex-col border-l border-[#333333] bg-[#0d0d0d] md:relative md:z-auto ${
          isMobile ? 'w-80' : ''
        }`}
        style={!isMobile ? { width: `${width}px` } : undefined}
      >
        {!isMobile && (
          <div
            role="separator"
            aria-label="Resize right sidebar"
            aria-orientation="vertical"
            onPointerDown={onResizeStart}
            className="absolute left-0 top-0 h-full w-1 -translate-x-1/2 cursor-col-resize bg-transparent transition-colors hover:bg-[#525252]"
          />
        )}
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

interface ProjectThread {
  id: string;
  title: string;
  execution_mode: ChatThreadExecutionMode;
  updated_at: Date;
}

export function Ui6ChatbotPage() {
  const isMobile = useMediaQuery('(max-width: 767px)');
  const { profiles } = useUserSystem();
  const [isThreadsExpanded, setIsThreadsExpanded] = useState(true);
  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(true);
  const [isRightSidebarOpen, setIsRightSidebarOpen] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [chats, setChats] = useState<Ui6Chat[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
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
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectThreadsById, setProjectThreadsById] = useState<
    Record<string, ProjectThread[]>
  >({});
  const [currentBranch, setCurrentBranch] = useState<string | null>(null);
  const [isUpdatingThreadMode, setIsUpdatingThreadMode] = useState(false);
  const [threadModeError, setThreadModeError] = useState<string | null>(null);
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [expandedProjects, setExpandedProjects] = useState<
    Record<string, boolean>
  >({});
  const initialDraftPrefs = useMemo(() => readDraftPrefs(), []);
  const [draftExecutor, setDraftExecutor] = useState<BaseCodingAgent | null>(
    initialDraftPrefs.executor
  );
  const [draftVariant, setDraftVariant] = useState<string | null>(
    initialDraftPrefs.variant
  );
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(256);
  const [rightSidebarWidth, setRightSidebarWidth] = useState(320);

  const messageScrollRef = useRef<HTMLDivElement | null>(null);
  const loadedThreadMessagesRef = useRef<Set<string>>(new Set());
  const activeStreamRef = useRef<ReturnType<
    typeof streamJsonPatchEntries<PatchType>
  > | null>(null);
  const activeStreamMetaRef = useRef<{
    threadId: string;
    processId: string;
    assistantMessageId: string;
  } | null>(null);
  const activeResizeRef = useRef<{
    side: 'left' | 'right';
    startX: number;
    startWidth: number;
  } | null>(null);

  const currentChat = useMemo(
    () => chats.find((chat) => chat.id === currentChatId) ?? null,
    [chats, currentChatId]
  );
  const executorOptions = useMemo(() => [DROID_EXECUTOR], []);
  const fallbackExecutor = DROID_EXECUTOR;
  const fallbackVariant = useMemo(
    () => getVariantOptions(fallbackExecutor, profiles)[0] ?? null,
    [fallbackExecutor, profiles]
  );
  const composerExecutor = currentChat?.selectedExecutor ?? draftExecutor;
  const effectiveComposerExecutor = composerExecutor ?? fallbackExecutor;
  const assistantLabel = useMemo(
    () => executorDisplayName(effectiveComposerExecutor),
    [effectiveComposerExecutor]
  );
  const variantOptions = useMemo(
    () => getVariantOptions(effectiveComposerExecutor, profiles),
    [effectiveComposerExecutor, profiles]
  );
  const composerVariant = currentChat?.selectedVariant ?? draftVariant;
  const effectiveComposerVariant = useMemo(() => {
    if (composerVariant && variantOptions.includes(composerVariant)) {
      return composerVariant;
    }
    return variantOptions[0] ?? null;
  }, [composerVariant, variantOptions]);
  useEffect(() => {
    if (draftExecutor !== DROID_EXECUTOR) {
      setDraftExecutor(DROID_EXECUTOR);
    }
  }, [draftExecutor]);

  useEffect(() => {
    if (draftVariant === null) {
      setDraftVariant(fallbackVariant);
    }
  }, [draftVariant, fallbackVariant]);

  useEffect(() => {
    writeDraftPrefs({ executor: draftExecutor, variant: draftVariant });
  }, [draftExecutor, draftVariant]);

  useEffect(() => {
    return () => {
      activeStreamRef.current?.close();
      activeStreamRef.current = null;
      activeStreamMetaRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!isMobile) {
      setIsLeftSidebarOpen(true);
    }
  }, [isMobile]);

  useEffect(() => {
    const loadCurrentBranch = async () => {
      if (!activeProjectId) {
        setCurrentBranch(null);
        return;
      }
      try {
        const repos = await projectsApi.getRepositories(activeProjectId);
        const firstRepo = repos[0];
        if (!firstRepo) {
          setCurrentBranch(null);
          return;
        }
        const branches = await repoApi.getBranches(firstRepo.id);
        const branch =
          branches.find((item) => item.is_current)?.name ??
          firstRepo.default_target_branch ??
          null;
        setCurrentBranch(branch);
      } catch {
        setCurrentBranch(null);
      }
    };

    void loadCurrentBranch();
  }, [activeProjectId, currentChat?.executionMode]);

  useEffect(() => {
    if (!messageScrollRef.current) return;
    messageScrollRef.current.scrollTop = messageScrollRef.current.scrollHeight;
  }, [currentChat?.messages, isTyping]);

  useEffect(() => {
    const LEFT_MIN = 220;
    const LEFT_MAX = 420;
    const RIGHT_MIN = 280;
    const RIGHT_MAX = 520;

    const clamp = (value: number, min: number, max: number) =>
      Math.min(max, Math.max(min, value));

    const handlePointerMove = (event: PointerEvent) => {
      const activeResize = activeResizeRef.current;
      if (!activeResize) return;

      if (activeResize.side === 'left') {
        const delta = event.clientX - activeResize.startX;
        setLeftSidebarWidth(
          clamp(activeResize.startWidth + delta, LEFT_MIN, LEFT_MAX)
        );
        return;
      }

      const delta = activeResize.startX - event.clientX;
      setRightSidebarWidth(
        clamp(activeResize.startWidth + delta, RIGHT_MIN, RIGHT_MAX)
      );
    };

    const handlePointerUp = () => {
      activeResizeRef.current = null;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, []);

  const startResize = (
    side: 'left' | 'right',
    event: React.PointerEvent<HTMLDivElement>
  ) => {
    if (isMobile) return;

    activeResizeRef.current = {
      side,
      startX: event.clientX,
      startWidth: side === 'left' ? leftSidebarWidth : rightSidebarWidth,
    };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
  };

  const upsertChatFromThread = (
    projectId: string,
    thread: ProjectThread,
    initialMessages: Ui6Message[] = []
  ) => {
    const now = new Date();
    const defaultVariant = getVariantOptions(DROID_EXECUTOR, profiles)[0] ?? null;
    const savedPrefs = readThreadPrefs()[thread.id];
    const persistedExecutor = DROID_EXECUTOR;
    const persistedVariant = savedPrefs?.variant ?? null;

    let chatToUse: Ui6Chat;
    setChats((prev) => {
      const existing = prev.find((chat) => chat.id === thread.id);
      if (existing) {
        const updatedExisting: Ui6Chat = {
          ...existing,
          title: thread.title,
          executionMode: thread.execution_mode,
          selectedExecutor: DROID_EXECUTOR,
          selectedVariant: existing.selectedVariant ?? persistedVariant ?? defaultVariant,
          updatedAt: new Date(thread.updated_at),
        };
        chatToUse = updatedExisting;
        return prev.map((chat) => (chat.id === thread.id ? updatedExisting : chat));
      }

      const created: Ui6Chat = {
        id: thread.id,
        projectId,
        title: thread.title,
        executionMode: thread.execution_mode,
        messages: initialMessages,
        selectedExecutor: persistedExecutor,
        selectedVariant: persistedVariant ?? defaultVariant,
        createdAt: now,
        updatedAt: now,
      };
      chatToUse = created;
      return [created, ...prev];
    });

    setCurrentChatId(thread.id);
    return chatToUse!;
  };

  const setAssistantMessage = useCallback((
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
  }, []);

  const upsertThreadMessages = useCallback((
    projectId: string,
    threadId: string,
    messages: Ui6Message[]
  ) => {
    setChats((prev) =>
      prev.map((chat) =>
        chat.id === threadId
          ? {
              ...chat,
              projectId,
              messages,
              updatedAt:
                messages.length > 0
                  ? messages[messages.length - 1]!.timestamp
                  : chat.updatedAt,
            }
          : chat
      )
    );
  }, []);

  const loadThreadMessages = useCallback(async (
    projectId: string,
    threadId: string,
    force = false
  ) => {
    if (!force && loadedThreadMessagesRef.current.has(threadId)) {
      return;
    }
    const messages = await newUiApi.listThreadMessages(threadId);
    upsertThreadMessages(
      projectId,
      threadId,
      messages.map(toUiMessage)
    );
    loadedThreadMessagesRef.current.add(threadId);
  }, [upsertThreadMessages]);

  const persistAssistantMessage = useCallback(async (
    threadId: string,
    processId: string,
    content: string
  ) => {
    const trimmed = content.trim();
    if (!trimmed) return;
    try {
      await newUiApi.upsertAssistantThreadMessage(threadId, {
        execution_process_id: processId,
        content: trimmed,
      });
    } catch {
      // Best effort to avoid blocking UI updates on persistence errors.
    }
  }, []);

  const finalizeAssistantMessageText = useCallback((
    process: ExecutionProcess,
    fallbackText: string
  ) => {
    if (process.status === 'completed') {
      return fallbackText || 'Completed.';
    }
    if (process.status === 'killed') {
      return `Stopped.${process.exit_code !== null ? ` Exit code ${process.exit_code}.` : ''}`;
    }
    if (process.status === 'failed') {
      return `Failed.${process.exit_code !== null ? ` Exit code ${process.exit_code}.` : ''}`;
    }
    return fallbackText || 'Completed.';
  }, []);

  const attachProcessStream = useCallback((threadId: string, processId: string) => {
    const assistantMessageId = `${processId}-assistant`;
    activeStreamRef.current?.close();
    activeStreamRef.current = null;
    activeStreamMetaRef.current = {
      threadId,
      processId,
      assistantMessageId,
    };
    setIsTyping(true);

    activeStreamRef.current = streamJsonPatchEntries<PatchType>(
      `/api/execution-processes/${processId}/normalized-logs/ws`,
      {
        onEntries: (entries) => {
          const assistantText = extractAssistantText(entries);
          if (assistantText) {
            setAssistantMessage(threadId, assistantMessageId, assistantText);
          }
        },
        onFinished: (entries) => {
          const assistantText = extractAssistantText(entries);
          void executionProcessesApi
            .getDetails(processId)
            .then((process) => {
              const finalText = finalizeAssistantMessageText(
                process,
                assistantText
              );
              setAssistantMessage(threadId, assistantMessageId, finalText);
              return persistAssistantMessage(threadId, processId, finalText);
            })
            .catch(() => {
              const fallback = assistantText || 'Completed.';
              setAssistantMessage(threadId, assistantMessageId, fallback);
              return persistAssistantMessage(threadId, processId, fallback);
            })
            .finally(() => {
              setIsTyping(false);
              activeStreamRef.current = null;
              activeStreamMetaRef.current = null;
            });
        },
        onError: () => {
          const text = 'Stream failed.';
          setAssistantMessage(threadId, assistantMessageId, text);
          void persistAssistantMessage(threadId, processId, text);
          setIsTyping(false);
          activeStreamRef.current = null;
          activeStreamMetaRef.current = null;
        },
      }
    );
  }, [finalizeAssistantMessageText, persistAssistantMessage, setAssistantMessage]);

  useEffect(() => {
    const threadId = currentChat?.id;
    const projectId = currentChat?.projectId;
    if (!threadId || !projectId) {
      return;
    }

    void loadThreadMessages(projectId, threadId);

    void (async () => {
      try {
        const activeProcess = await newUiApi.getActiveThreadProcess(threadId);
        if (!activeProcess) {
          return;
        }
        const activeMeta = activeStreamMetaRef.current;
        if (
          activeMeta &&
          activeMeta.threadId === threadId &&
          activeMeta.processId === activeProcess.id
        ) {
          return;
        }
        attachProcessStream(threadId, activeProcess.id);
      } catch {
        // Non-fatal: thread remains usable without reconnect.
      }
    })();
  }, [attachProcessStream, currentChat?.id, currentChat?.projectId, loadThreadMessages]);

  const loadProjects = useCallback(async () => {
    setIsLoadingProjects(true);
    setProjectsError(null);

    try {
      const loadedProjects = await projectsApi.list();
      setProjects(loadedProjects);
      setActiveProjectId((prev) =>
        prev ?? (loadedProjects.length > 0 ? loadedProjects[0].id : null)
      );
      setExpandedProjects((prev) => {
        const next = { ...prev };
        loadedProjects.forEach((project) => {
          if (next[project.id] === undefined) {
            next[project.id] = true;
          }
        });
        return next;
      });

      const threadEntries = await Promise.all(
        loadedProjects.map(async (project) => {
          const threads = await newUiApi.listThreads(project.id);
          const mapped = threads.map((thread) => ({
            id: thread.id,
            title: thread.title,
            execution_mode: thread.execution_mode,
            updated_at: new Date(thread.updated_at),
          }));
          return [project.id, mapped] as const;
        })
      );
      setProjectThreadsById(Object.fromEntries(threadEntries));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to load projects.';
      setProjectsError(message);
    } finally {
      setIsLoadingProjects(false);
    }
  }, []);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  const sendToBackend = async (
    chat: Ui6Chat,
    prompt: string,
    selectedExecutor: BaseCodingAgent | null,
    selectedVariant: string | null
  ) => {
    if (!selectedExecutor) {
      setAssistantMessage(
        chat.id,
        `${Date.now()}-assistant`,
        'No executor available. Configure an agent in Settings.'
      );
      return;
    }

    setIsTyping(true);

    try {
      const process = await newUiApi.sendThreadMessage(chat.id, {
        prompt,
        executor_profile_id: {
          executor: selectedExecutor,
          variant: selectedVariant,
        },
        retry_process_id: null,
        force_when_dirty: null,
        perform_git_reset: null,
      });
      attachProcessStream(chat.id, process.id);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown backend error';
      setAssistantMessage(chat.id, `${Date.now()}-assistant`, `Error: ${message}`);
      setIsTyping(false);
    }
  };

  const handleSendMessage = (message: string) => {
    const trimmed = message.trim();
    if (!trimmed) return;

    if (!currentChat) {
      if (!activeProjectId) {
        return;
      }
      const userMessage: Ui6Message = {
        id: `${Date.now()}-user`,
        text: trimmed,
        isUser: true,
        timestamp: new Date(),
      };

      void (async () => {
        const title =
          trimmed.slice(0, 50) + (trimmed.length > 50 ? '...' : '');
        const createdThread = await newUiApi.createThread(activeProjectId, {
          title,
          execution_mode: 'in_place',
        });
        const thread: ProjectThread = {
          id: createdThread.id,
          title: createdThread.title,
          execution_mode: createdThread.execution_mode,
          updated_at: new Date(createdThread.updated_at),
        };
        setProjectThreadsById((prev) => ({
          ...prev,
          [activeProjectId]: [thread, ...(prev[activeProjectId] ?? [])],
        }));
        const newChat = upsertChatFromThread(activeProjectId, thread, [userMessage]);
        loadedThreadMessagesRef.current.add(newChat.id);
        const selectedExecutor =
          DROID_EXECUTOR;
        const selectedVariant =
          draftVariant ?? newChat.selectedVariant ?? fallbackVariant;
        writeThreadPrefs(newChat.id, {
          executor: selectedExecutor,
          variant: selectedVariant,
        });

        setChats((prev) =>
          prev.map((chat) =>
            chat.id === newChat.id
              ? {
                  ...chat,
                  selectedExecutor,
                  selectedVariant,
                }
              : chat
          )
        );

        await sendToBackend(newChat, trimmed, selectedExecutor, selectedVariant);
      })();
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
          updatedAt: new Date(),
          messages: [...chat.messages, userMessage],
        };
      })
    );

    void sendToBackend(
      currentChat,
      trimmed,
      currentChat.selectedExecutor,
      currentChat.selectedVariant
    );
  };

  const handleExecutorChange = (executor: BaseCodingAgent) => {
    void executor;
    const forcedExecutor = DROID_EXECUTOR;
    const nextVariant = getVariantOptions(forcedExecutor, profiles)[0] ?? null;
    if (!currentChat) {
      setDraftExecutor(forcedExecutor);
      setDraftVariant(nextVariant);
      return;
    }
    writeThreadPrefs(currentChat.id, { executor: forcedExecutor, variant: nextVariant });
    setChats((prev) =>
      prev.map((chat) =>
        chat.id === currentChat.id
          ? {
              ...chat,
              selectedExecutor: forcedExecutor,
              selectedVariant: nextVariant,
            }
          : chat
      )
    );
  };

  const handleVariantChange = (variant: string | null) => {
    if (!currentChat) {
      setDraftVariant(variant);
      return;
    }
    writeThreadPrefs(currentChat.id, {
      executor: DROID_EXECUTOR,
      variant,
    });
    setChats((prev) =>
      prev.map((chat) =>
        chat.id === currentChat.id
          ? {
              ...chat,
              selectedVariant: variant,
            }
          : chat
      )
    );
  };

  const openCreateProjectModal = () => {
    setCreateProjectMessage(null);
    setRepoPickerMessage(null);
    setIsCreateProjectModalOpen(true);
  };

  const closeCreateProjectModal = () => {
    setIsCreateProjectModalOpen(false);
  };

  const toggleProjectExpanded = (projectId: string) => {
    setExpandedProjects((prev) => ({
      ...prev,
      [projectId]: !(prev[projectId] ?? true),
    }));
  };

  const handleCreateThread = async (projectId: string) => {
    const createdThread = await newUiApi.createThread(projectId, {
      title: 'New thread',
      execution_mode: 'in_place',
    });
    const thread: ProjectThread = {
      id: createdThread.id,
      title: createdThread.title,
      execution_mode: createdThread.execution_mode,
      updated_at: new Date(createdThread.updated_at),
    };
    setProjectThreadsById((prev) => ({
      ...prev,
      [projectId]: [thread, ...(prev[projectId] ?? [])],
    }));
    upsertChatFromThread(projectId, thread, []);
    loadedThreadMessagesRef.current.delete(thread.id);
    await loadThreadMessages(projectId, thread.id, true);
  };

  const handleOpenThread = (projectId: string, thread: ProjectThread) => {
    setActiveProjectId(projectId);
    upsertChatFromThread(projectId, thread, []);
    void loadThreadMessages(projectId, thread.id);
  };

  const handleThreadModeChange = async (
    nextMode: ChatThreadExecutionMode
  ) => {
    if (!currentChat || currentChat.executionMode === nextMode) return;

    setIsUpdatingThreadMode(true);
    setThreadModeError(null);
    try {
      const updated = await newUiApi.updateThread(currentChat.id, {
        title: null,
        execution_mode: nextMode,
      });

      setChats((prev) =>
        prev.map((chat) =>
          chat.id === updated.id
            ? {
                ...chat,
                title: updated.title,
                executionMode: updated.execution_mode,
                updatedAt: new Date(updated.updated_at),
              }
            : chat
        )
      );

      setProjectThreadsById((prev) => ({
        ...prev,
        [currentChat.projectId]: (prev[currentChat.projectId] ?? []).map((thread) =>
          thread.id === updated.id
            ? {
                ...thread,
                title: updated.title,
                execution_mode: updated.execution_mode,
                updated_at: new Date(updated.updated_at),
              }
            : thread
        ),
      }));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to switch mode';
      setThreadModeError(message);
    } finally {
      setIsUpdatingThreadMode(false);
    }
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

      await loadProjects();
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
            ${isMobile ? 'fixed left-0 top-0 w-64' : ''}
            ${isLeftSidebarOpen ? 'translate-x-0' : '-translate-x-full md:hidden'}
          `}
          style={!isMobile ? { width: `${leftSidebarWidth}px` } : undefined}
        >
          <div className="space-y-2 p-3">
            <button
              type="button"
              onClick={() => {
                if (!activeProjectId) return;
                void handleCreateThread(activeProjectId);
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
                {isLoadingProjects ? (
                  <p className="px-2 py-1.5 text-xs text-[#777777]">
                    Loading projects...
                  </p>
                ) : projectsError ? (
                  <p className="px-2 py-1.5 text-xs text-[#ff8f8f]">
                    {projectsError}
                  </p>
                ) : projects.length === 0 ? (
                  <p className="px-2 py-1.5 text-xs text-[#777777]">No projects</p>
                ) : (
                  projects.map((project) => {
                    const isExpanded = expandedProjects[project.id] ?? true;
                    const projectThreads = projectThreadsById[project.id] ?? [];

                    return (
                      <div key={project.id}>
                        <div
                          className={`group flex w-full items-center gap-1 rounded transition-colors hover:bg-[#2a2a2a] ${
                            activeProjectId === project.id ? 'bg-[#222222]' : ''
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setActiveProjectId(project.id);
                              toggleProjectExpanded(project.id);
                            }}
                            className={`flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1.5 text-left text-sm ${
                              activeProjectId === project.id
                                ? 'text-[#f5f5f5]'
                                : 'text-[#e5e5e5]'
                            }`}
                          >
                            {isExpanded ? (
                              <ChevronDown className="h-3 w-3 flex-shrink-0" />
                            ) : (
                              <ChevronRight className="h-3 w-3 flex-shrink-0" />
                            )}
                            <span className="flex-1 truncate">{project.name}</span>
                          </button>

                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setActiveProjectId(project.id);
                              void handleCreateThread(project.id);
                            }}
                            className="pointer-events-none mr-1 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-[#a1a1a1] opacity-0 transition-all hover:bg-[#343434] hover:text-[#f5f5f5] group-hover:pointer-events-auto group-hover:opacity-100 focus:pointer-events-auto focus:opacity-100 focus:outline-none"
                            aria-label={`Create thread in ${project.name}`}
                            title={`Create thread in ${project.name}`}
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        </div>

                        {isExpanded && (
                          <div className="ml-4 mt-0.5 space-y-0.5">
                            {projectThreads.length === 0 ? (
                              <p className="rounded px-2 py-1.5 text-xs text-[#777777]">
                                No threads
                              </p>
                            ) : (
                              projectThreads.map((thread) => (
                                <button
                                  type="button"
                                  key={thread.id}
                                  onClick={() => {
                                    handleOpenThread(project.id, thread);
                                    if (isMobile) setIsLeftSidebarOpen(false);
                                  }}
                                  className="flex w-full items-center rounded px-2 py-1.5 text-left text-sm text-[#a1a1a1] transition-colors hover:bg-[#2a2a2a] hover:text-[#e5e5e5]"
                                >
                                  <span className="truncate">{thread.title}</span>
                                </button>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
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

        {!isMobile && isLeftSidebarOpen && (
          <div
            role="separator"
            aria-label="Resize left sidebar"
            aria-orientation="vertical"
            onPointerDown={(event) => startResize('left', event)}
            className="z-20 h-full w-1 -translate-x-1/2 cursor-col-resize bg-transparent transition-colors hover:bg-[#525252]"
          />
        )}

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
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
            <div className="flex h-full min-h-0 flex-col bg-[#0d0d0d]">
              <div ref={messageScrollRef} className="min-h-0 flex-1 overflow-y-auto">
                <div className="mx-auto max-w-4xl px-6 py-8">
                  {currentChat.messages.map((message) => (
                    <Ui6ChatMessage
                      key={message.id}
                      message={message}
                      assistantLabel={assistantLabel}
                    />
                  ))}
                  {isTyping && <Ui6TypingIndicator assistantLabel={assistantLabel} />}
                </div>
              </div>

              <div className="flex-shrink-0 border-t border-[#1a1a1a] bg-[#0d0d0d] px-6 py-4">
                <div className="mx-auto max-w-4xl">
                  <Ui6ChatInput
                    onSendMessage={handleSendMessage}
                    selectedExecutor={effectiveComposerExecutor}
                    selectedVariant={effectiveComposerVariant}
                    executorOptions={executorOptions}
                    variantOptions={variantOptions}
                    onExecutorChange={handleExecutorChange}
                    onVariantChange={handleVariantChange}
                    disabled={isTyping}
                  />
                  <Ui6ExecutionBar
                    currentMode={currentChat.executionMode}
                    onModeChange={(mode) => {
                      void handleThreadModeChange(mode);
                    }}
                    isUpdatingMode={isUpdatingThreadMode}
                    modeError={threadModeError}
                    currentBranch={currentBranch}
                    disabled={isTyping}
                  />
                </div>
              </div>
            </div>
          ) : (
            <Ui6Welcome
              onSendMessage={handleSendMessage}
              selectedExecutor={effectiveComposerExecutor}
              selectedVariant={effectiveComposerVariant}
              executorOptions={executorOptions}
              variantOptions={variantOptions}
              onExecutorChange={handleExecutorChange}
              onVariantChange={handleVariantChange}
              currentMode={currentChat?.executionMode ?? null}
              onModeChange={(mode) => {
                void handleThreadModeChange(mode);
              }}
              isUpdatingMode={isUpdatingThreadMode}
              modeError={threadModeError}
              currentBranch={currentBranch}
              disabled={isTyping}
            />
          )}
        </div>

        <Ui6RightSidebar
          isOpen={isRightSidebarOpen}
          onClose={() => setIsRightSidebarOpen(false)}
          width={rightSidebarWidth}
          isMobile={isMobile}
          onResizeStart={(event) => startResize('right', event)}
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
